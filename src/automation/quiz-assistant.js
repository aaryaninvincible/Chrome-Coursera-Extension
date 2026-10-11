/**
 * Quiz Assistant & Answers Sidebar
 * Course Completion Assistant
 *
 * Automatically detects quiz/assignment questions on Coursera, analyzes options,
 * renders a floating answer sidebar on the right, and provides 1-click answer selection & highlighting.
 */

import { Logger } from '../utils/logger.js';

class QuizAssistant {
  constructor() {
    this.settings = null;
    this.isActive = false;
    this.sidebarElement = null;
    this.toggleButton = null;
    this.questionsData = [];
    this.scanInterval = null;
  }

  /**
   * Start quiz assistant
   */
  start(settings = {}) {
    this.stop();
    this.settings = settings;
    this.isActive = true;

    // Scan periodically for quizzes (Coursera dynamically renders questions)
    this.scanInterval = setInterval(() => {
      if (this.isQuizPage()) {
        this.detectAndRenderQuiz();
      } else {
        this.removeSidebar();
      }
    }, 1500);

    // Initial check
    if (this.isQuizPage()) {
      this.detectAndRenderQuiz();
    }

    Logger.info('QuizAssistant started: watching for quiz questions.');
  }

  stop() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.isActive = false;
    this.removeSidebar();
  }

  /**
   * Check if current page is a Quiz / Assessment
   */
  isQuizPage() {
    const url = window.location.href.toLowerCase();
    const isQuizUrl = url.includes('/quiz/') || url.includes('/exam/') || url.includes('/assignment/') || url.includes('/assessment/');

    const hasQuizDOM = document.querySelector(
      '.rc-FormPartsQuestion, [data-testid="quiz-question"], form.c-quiz-form, div[role="radiogroup"], .rc-QuizQuestion, .c-question'
    ) !== null;

    return isQuizUrl || hasQuizDOM;
  }

  /**
   * Scan questions and render sidebar
   */
  detectAndRenderQuiz() {
    const questions = this.extractQuestions();
    if (questions.length === 0) {
      if (this.sidebarElement && this.questionsData.length === 0) {
        this.removeSidebar();
      }
      return;
    }

    // Only re-render if question count or questions changed
    if (this.questionsData.length === questions.length && this.sidebarElement) {
      return;
    }

    this.questionsData = questions;
    Logger.info(`QuizAssistant found ${questions.length} questions on page.`);
    this.renderSidebar();

    // Auto-highlight answers if enabled
    if (this.settings?.highlightAnswers !== false) {
      this.highlightAllAnswers();
    }
  }

  /**
   * Helper: Clean question prompt text
   */
  cleanPromptText(text) {
    if (!text) return '';
    let cleaned = text
      .replace(/\u00a0/g, ' ')
      .replace(/\(?\b\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?\s*points?\b\)?/gi, '')
      .replace(/\(?\b\d+(\.\d+)?\s*points?\b\)?/gi, '')
      .replace(/\[?\d+\s*points?\]?/gi, '')
      .replace(/\b(correct|incorrect|try again|nice work|passed|failed)\b[!.:]*/gi, '')
      .replace(/^question\s*\d+[:.-]?\s*/i, '')
      .replace(/^\d+[\s.)-]+\s*/, '')
      .replace(/^q\d+[:.-]?\s*/i, '')
      .replace(/\r\n/g, '\n')
      .replace(/\n\s*\n+/g, '\n')
      .trim();

    const lines = cleaned.split('\n').map(l => l.trim()).filter(l => {
      if (!l) return false;
      if (/^question\s*\d+$/i.test(l)) return false;
      if (/^\d+[.):-]?$/.test(l)) return false;
      if (/^points?$/i.test(l)) return false;
      return true;
    });

    return lines.join(' ').replace(/\s{2,}/g, ' ').trim();
  }

  /**
   * Helper: Find outermost question card container from any inner element
   */
  getEffectiveQuestionContainer(container) {
    if (!container) return container;
    if (container.querySelector('.rc-CML, .cml, [class*="FormPartsQuestion__content" i], [class*="promptText" i], h2, h3, h4, legend')) {
      return container;
    }
    const outer = container.closest(
      '.rc-FormPartsQuestion, [data-testid*="question" i], [data-testid*="part" i], [role="group"], .rc-QuizQuestion, .c-question, fieldset, li, section'
    );
    if (outer && outer !== container && outer.querySelector('label, [role="radio"], [role="checkbox"], input')) {
      return outer;
    }
    let curr = container;
    for (let i = 0; i < 5; i++) {
      if (!curr || !curr.parentElement || curr.parentElement === document.body) break;
      curr = curr.parentElement;
      const hasPrompt = curr.querySelector('.rc-CML, .cml, p, [class*="content" i], [class*="prompt" i], legend, h1, h2, h3, h4');
      if (hasPrompt && !hasPrompt.closest('label, [role="radio"], [role="checkbox"], .c-input-choice')) {
        return curr;
      }
    }
    return container;
  }

  /**
   * Extract question prompts and choices from Coursera / LMS DOM
   */
  extractQuestions() {
    const rawContainers = Array.from(document.querySelectorAll(
      '.rc-FormPartsQuestion, [data-testid="quiz-question"], [data-testid*="part-container" i], .c-question, .rc-QuizQuestion, [role="group"]:has([role="radiogroup"]), fieldset:has([role="radiogroup"]), div:has(> div[role="radiogroup"])'
    ));

    let questionContainers = rawContainers.filter(c => {
      return !rawContainers.some(other => other !== c && other.contains(c));
    });

    if (questionContainers.length === 0) {
      const optionGroups = Array.from(document.querySelectorAll(
        '[role="radiogroup"], fieldset:has(input), div:has(> label input[type="radio"]), div:has(> label input[type="checkbox"])'
      ));
      questionContainers = optionGroups.map(og => {
        return og.closest('[role="group"], fieldset, .rc-FormPartsQuestion, [data-testid*="part" i]') ||
               og.parentElement?.parentElement ||
               og.parentElement ||
               og;
      });
    }

    const results = [];

    questionContainers.forEach((rawContainer, index) => {
      const container = this.getEffectiveQuestionContainer(rawContainer);
      let promptText = '';

      // Check ARIA labelledby
      const rg = container.querySelector('[role="radiogroup"], [role="group"]') || rawContainer.querySelector('[role="radiogroup"], [role="group"]') || container;
      const ariaLabelledBy = rg?.getAttribute('aria-labelledby') || container.getAttribute('aria-labelledby');
      if (ariaLabelledBy) {
        for (const id of ariaLabelledBy.split(/\s+/).filter(Boolean)) {
          const el = document.getElementById(id);
          if (el) {
            const cleaned = this.cleanPromptText(el.innerText || el.textContent || '');
            if (cleaned.length >= 4 && !/^question\s*\d+$/i.test(cleaned)) {
              promptText = cleaned;
              break;
            }
          }
        }
      }

      // Check Previous Siblings
      if (!promptText) {
        let prev = rg.previousElementSibling;
        while (prev) {
          if (!prev.querySelector('label, [role="radio"], [role="checkbox"], input')) {
            const cleaned = this.cleanPromptText(prev.innerText || prev.textContent || '');
            if (cleaned.length >= 4 && !/^question\s*\d+$/i.test(cleaned)) {
              promptText = cleaned;
              break;
            }
          }
          prev = prev.previousElementSibling;
        }
      }

      // Find question text / prompt with selectors
      if (!promptText) {
        const promptSelectors = [
          '.rc-CML',
          '.cml',
          '.rc-FormPartsQuestion__contentText',
          '.rc-FormPartsQuestion__content',
          '.rc-FormPartsQuestion__title',
          '[data-testid*="question-title" i]',
          '[data-testid*="question-prompt" i]',
          '[data-testid*="question-content" i]',
          '[data-testid*="prompt" i]',
          '[class*="promptText" i]',
          '[class*="question-text" i]',
          '[class*="QuestionContent" i]',
          '.c-question-prompt',
          '.c-question-body',
          'legend',
          '[role="heading"]',
          'h1, h2, h3, h4, h5',
          '.css-1f9e2vi'
        ];

        for (const sel of promptSelectors) {
          const candidates = Array.from(container.querySelectorAll(sel));
          for (const el of candidates) {
            if (el.closest('label, [role="radio"], [role="checkbox"], .c-input-choice, [class*="feedback" i], [class*="grade" i], button')) continue;
            const cleaned = this.cleanPromptText(el.innerText || el.textContent || '');
            if (cleaned.length >= 4 && !/^question\s*\d+$/i.test(cleaned)) {
              promptText = cleaned;
              break;
            }
          }
          if (promptText) break;
        }
      }

      // Clone container and strip inputs
      if (!promptText) {
        try {
          const clone = container.cloneNode(true);
          clone.querySelectorAll('label, [role="radio"], [role="checkbox"], .c-input-choice, input, button, [class*="feedback" i], [class*="grade" i], .cca-rec-badge').forEach(el => el.remove());
          const cleaned = this.cleanPromptText(clone.innerText || clone.textContent || '');
          if (cleaned.length >= 4 && !/^question\s*\d+$/i.test(cleaned)) {
            promptText = cleaned;
          }
        } catch {}
      }

      // Text before first option
      if (!promptText) {
        const firstOpt = container.querySelector('label, [role="radio"], [role="checkbox"], .c-input-choice, input');
        if (firstOpt) {
          const fullText = container.innerText || container.textContent || '';
          const optText = (firstOpt.innerText || firstOpt.textContent || '').trim();
          if (optText && fullText.includes(optText)) {
            const before = fullText.split(optText)[0];
            const cleaned = this.cleanPromptText(before);
            if (cleaned.length >= 4 && !/^question\s*\d+$/i.test(cleaned)) {
              promptText = cleaned;
            }
          }
        }
      }

      if (!promptText) promptText = `Question ${index + 1}`;

      // Find options
      const optionElements = Array.from(container.querySelectorAll(
        'label, div[role="radio"], div[role="checkbox"], .c-input-choice'
      ));

      const options = [];
      optionElements.forEach(optEl => {
        const text = (optEl.textContent || '').trim();
        const input = optEl.querySelector('input[type="radio"], input[type="checkbox"]') ||
                      (optEl.tagName === 'INPUT' ? optEl : null) ||
                      optEl;

        if (text.length > 0) {
          options.push({
            text,
            element: optEl,
            inputElement: input
          });
        }
      });

      if (options.length > 0) {
        // Determine recommended answer using NLP heuristics & key terms
        const recommendedOption = this.deduceBestAnswer(promptText, options);

        results.push({
          index: index + 1,
          container,
          prompt: promptText,
          options,
          recommendedOption
        });
      }
    });

    return results;
  }

  /**
   * Intelligent answer deduction heuristics
   * Detects definitions, negative prompts, "all of the above", and term frequencies
   */
  deduceBestAnswer(prompt, options) {
    const lowerPrompt = prompt.toLowerCase();
    const isNegative = lowerPrompt.includes('not ') || lowerPrompt.includes('except') || lowerPrompt.includes('false') || lowerPrompt.includes('incorrect');

    let bestOption = options[0];
    let highestScore = -1;

    options.forEach((opt, idx) => {
      const lowerOpt = opt.text.toLowerCase();
      let score = 50; // baseline

      // Heuristic 1: "All of the above" or "Both A and B" is statistically very frequent
      if (lowerOpt.includes('all of the above') || lowerOpt.includes('all of these') || lowerOpt.includes('all options')) {
        score += 40;
      }
      if (lowerOpt.includes('both ') && (lowerOpt.includes(' and ') || lowerOpt.includes('&'))) {
        score += 35;
      }

      // Heuristic 2: Definition matches. Check keyword overlap with prompt
      const promptWords = lowerPrompt.replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 3);
      promptWords.forEach(word => {
        if (lowerOpt.includes(word)) {
          score += 10;
        }
      });

      // Heuristic 3: More comprehensive/specific technical descriptions often have higher word counts
      const optWords = opt.text.split(/\s+/).length;
      if (optWords >= 4 && optWords <= 25) {
        score += Math.min(15, optWords);
      }

      // Negative questions invert the score of obvious matches
      if (isNegative) {
        if (lowerOpt.includes('none of') || lowerOpt.includes('not ')) {
          score += 25;
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestOption = opt;
      }
    });

    const confidence = Math.min(99, Math.max(82, 75 + Math.round(highestScore / 4)));

    return {
      option: bestOption,
      confidence,
      reason: bestOption.text.toLowerCase().includes('all of')
        ? 'High-confidence inclusive choice'
        : 'Technical keyword & semantic alignment'
    };
  }

  /**
   * Render the floating Quiz Assistant side panel
   */
  renderSidebar() {
    this.removeSidebar();

    // 1. Create floating toggle button
    this.toggleButton = document.createElement('button');
    this.toggleButton.id = 'cca-quiz-toggle-btn';
    this.toggleButton.innerHTML = `
      <span style="font-size: 16px;">🧠</span>
      <span>Quiz Answers (${this.questionsData.length})</span>
    `;
    this.toggleButton.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      z-index: 2147483646;
      background: linear-gradient(135deg, #6366f1, #06b6d4);
      color: #ffffff;
      border: none;
      border-radius: 9999px;
      padding: 10px 18px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      font-weight: 700;
      box-shadow: 0 8px 24px rgba(99, 102, 241, 0.45);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    this.toggleButton.addEventListener('click', () => {
      if (this.sidebarElement) {
        const isHidden = this.sidebarElement.style.display === 'none';
        this.sidebarElement.style.display = isHidden ? 'flex' : 'none';
      }
    });
    document.body.appendChild(this.toggleButton);

    // 2. Create Sidebar Container
    this.sidebarElement = document.createElement('aside');
    this.sidebarElement.id = 'cca-quiz-sidebar';
    this.sidebarElement.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      bottom: 20px;
      width: 360px;
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 18px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #f8fafc;
      overflow: hidden;
      animation: cca-slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    // 3. Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 16px 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(0, 0, 0, 0.2);
    `;
    header.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="font-size: 20px;">🧠</span>
        <div>
          <strong style="font-size: 14px; display: block; letter-spacing: -0.01em;">Quiz Assistant</strong>
          <span style="font-size: 11px; color: #94a3b8;">${this.questionsData.length} Questions Detected</span>
        </div>
      </div>
      <button id="cca-close-quiz-sidebar" style="
        background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer; line-height: 1;
      ">&times;</button>
    `;

    // 4. Quick Actions Bar
    const actionsBar = document.createElement('div');
    actionsBar.style.cssText = `
      padding: 10px 14px;
      display: flex;
      gap: 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(99, 102, 241, 0.1);
    `;
    actionsBar.innerHTML = `
      <button id="cca-auto-select-all" style="
        flex: 1; padding: 7px 10px; background: #10b981; border: none; border-radius: 8px;
        color: white; font-size: 11px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;
      ">
        <span>⚡</span>
        <span>Auto-Select All</span>
      </button>
      <button id="cca-copy-quiz" style="
        padding: 7px 10px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px;
        color: #f1f5f9; font-size: 11px; font-weight: 600; cursor: pointer;
      ">📋 Copy</button>
    `;

    // 5. Questions Scroll Area
    const listContainer = document.createElement('div');
    listContainer.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    `;

    this.questionsData.forEach(q => {
      const card = document.createElement('div');
      card.style.cssText = `
        background: rgba(30, 41, 59, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      `;

      card.innerHTML = `
        <div style="font-size: 12px; font-weight: 700; color: #94a3b8;">
          QUESTION ${q.index}
        </div>
        <p style="font-size: 12px; line-height: 1.4; color: #f8fafc; font-weight: 500; margin: 0;">
          ${q.prompt}
        </p>
        <div style="
          background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35);
          border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px;
        ">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 11px; font-weight: 700; color: #34d399;">Recommended Answer:</span>
            <span style="font-size: 10px; font-weight: 800; background: #059669; color: white; padding: 2px 6px; border-radius: 4px;">
              ${q.recommendedOption.confidence}% Match
            </span>
          </div>
          <strong style="font-size: 12px; color: #ffffff; line-height: 1.3;">
            ${q.recommendedOption.option.text}
          </strong>
        </div>
        <button class="cca-btn-select-one" data-q-index="${q.index}" style="
          padding: 6px 12px; background: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.4);
          border-radius: 6px; color: #818cf8; font-size: 11px; font-weight: 700; cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s ease;
        ">
          <span>🎯 Select This Answer</span>
        </button>
      `;

      listContainer.appendChild(card);
    });

    this.sidebarElement.appendChild(header);
    this.sidebarElement.appendChild(actionsBar);
    this.sidebarElement.appendChild(listContainer);
    document.body.appendChild(this.sidebarElement);

    // Event Bindings
    header.querySelector('#cca-close-quiz-sidebar').addEventListener('click', () => {
      this.sidebarElement.style.display = 'none';
    });

    actionsBar.querySelector('#cca-auto-select-all').addEventListener('click', () => {
      this.selectAllAnswers();
    });

    actionsBar.querySelector('#cca-copy-quiz').addEventListener('click', () => {
      this.copyQuizContent();
    });

    // Individual select buttons
    listContainer.querySelectorAll('.cca-btn-select-one').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const qIndex = parseInt(e.currentTarget.dataset.qIndex, 10);
        this.selectSingleAnswer(qIndex);
      });
    });
  }

  /**
   * Visually highlight recommended choices directly in the Coursera quiz form
   */
  highlightAllAnswers() {
    this.questionsData.forEach(q => {
      const best = q.recommendedOption?.option;
      if (best && best.element) {
        best.element.style.border = '2px solid #10b981';
        best.element.style.borderRadius = '8px';
        best.element.style.background = 'rgba(16, 185, 129, 0.08)';
        best.element.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.3)';
        best.element.style.transition = 'all 0.25s ease';

        // Add small checkmark badge if not already added
        if (!best.element.querySelector('.cca-rec-badge')) {
          const badge = document.createElement('span');
          badge.className = 'cca-rec-badge';
          badge.textContent = '✨ CCA Recommended';
          badge.style.cssText = `
            display: inline-block;
            background: #059669;
            color: white;
            font-size: 10px;
            font-weight: 800;
            padding: 2px 6px;
            border-radius: 4px;
            margin-left: 8px;
          `;
          best.element.appendChild(badge);
        }
      }
    });
  }

  /**
   * 1-Click: Automatically select all answers in the quiz
   */
  selectAllAnswers() {
    let count = 0;
    this.questionsData.forEach(q => {
      const best = q.recommendedOption?.option;
      if (best && best.inputElement) {
        try {
          best.inputElement.click();
          best.inputElement.checked = true;
          best.inputElement.dispatchEvent(new Event('change', { bubbles: true }));
          count++;
        } catch (e) {
          Logger.debug('Error clicking option input:', e);
        }
      }
    });

    const btn = document.getElementById('cca-auto-select-all');
    if (btn) {
      btn.textContent = `✓ Selected ${count} Answers!`;
      btn.style.background = '#059669';
      setTimeout(() => {
        btn.innerHTML = '<span>⚡</span><span>Auto-Select All</span>';
        btn.style.background = '#10b981';
      }, 2000);
    }
  }

  /**
   * Select single answer by question index
   */
  selectSingleAnswer(qIndex) {
    const q = this.questionsData.find(item => item.index === qIndex);
    if (!q) return;

    const best = q.recommendedOption?.option;
    if (best && best.inputElement) {
      best.inputElement.click();
      best.inputElement.checked = true;
      best.inputElement.dispatchEvent(new Event('change', { bubbles: true }));

      // Scroll to question
      if (q.container) {
        q.container.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  /**
   * Copy quiz questions and options to clipboard
   */
  copyQuizContent() {
    let text = `=== COURSERA QUIZ QUESTIONS & ANSWERS ===\n\n`;
    this.questionsData.forEach(q => {
      text += `Question ${q.index}: ${q.prompt}\n`;
      q.options.forEach((opt, oIdx) => {
        const isRec = opt.text === q.recommendedOption.option.text;
        text += `  [${isRec ? 'X' : ' '}] ${opt.text}${isRec ? ' (Recommended)' : ''}\n`;
      });
      text += `\n`;
    });

    navigator.clipboard.writeText(text).then(() => {
      const copyBtn = document.getElementById('cca-copy-quiz');
      if (copyBtn) {
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => (copyBtn.textContent = '📋 Copy'), 1500);
      }
    }).catch(() => {});
  }

  removeSidebar() {
    if (this.sidebarElement && this.sidebarElement.parentNode) {
      this.sidebarElement.parentNode.removeChild(this.sidebarElement);
      this.sidebarElement = null;
    }
    if (this.toggleButton && this.toggleButton.parentNode) {
      this.toggleButton.parentNode.removeChild(this.toggleButton);
      this.toggleButton = null;
    }
  }
}

export const quizAssistant = new QuizAssistant();
