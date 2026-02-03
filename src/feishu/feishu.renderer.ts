// src/feishu/feishu.renderer.ts

type FeishuCard = {
  config?: { wide_screen_mode?: boolean };
  header?: { title: { tag: 'plain_text'; content: string }; template?: string };
  elements: any[];
};

function trimSafe(s: string) {
  return (s || '').trim();
}

function larkMd(content: string) {
  return {
    tag: 'div',
    text: { tag: 'lark_md', content: content },
  };
}

function collapsiblePanel(title: string, content: string, expanded = false) {
  const c = trimSafe(content);
  if (!c) return null;

  return {
    tag: 'collapsible_panel',
    expanded: expanded,
    background_style: 'grey',
    header: {
      title: { tag: 'plain_text', content: title },
    },
    border: {
      top: true,
      bottom: true,
    },
    elements: [larkMd(c)],
  };
}

function getStatusWithEmoji(statusText: string): string {
  const s = statusText.toLowerCase();
  const isDone =
    s.includes('done') || s.includes('stop') || s.includes('finish') || s.includes('idle');

  const emoji = isDone ? '✅' : '⚡️';

  const cleanText = statusText.replace(/\n/g, ' | ').slice(0, 100);
  return `${emoji} ${cleanText}`;
}

function parseSections(md: string) {
  const sectionMap: Record<string, string> = {
    thinking: '',
    answer: '',
    tools: '',
    status: '',
  };

  let cleanMd = md;

  const thinkingBlockRegex = /^(\s*> [^]*?)(?=\n[^>]|$)/;
  const thinkingMatch = md.match(thinkingBlockRegex);

  if (thinkingMatch && !md.includes('## Thinking')) {
    sectionMap.thinking = thinkingMatch[1];
    cleanMd = md.slice(thinkingMatch[0].length);
  }

  const headerRegex = /(?:^|\n)(##+|(?:\*\*))\s*(.*?)(?:(?:\*\*|:)?)(?=\n|$)/g;
  let match;

  const firstMatch = headerRegex.exec(cleanMd);
  if (firstMatch && firstMatch.index > 0) {
    sectionMap.answer = cleanMd.slice(0, firstMatch.index);
  }
  headerRegex.lastIndex = 0;

  while ((match = headerRegex.exec(cleanMd)) !== null) {
    const rawTitle = match[2].toLowerCase().trim();
    const startIndex = match.index + match[0].length;
    const nextMatch = headerRegex.exec(cleanMd);
    const endIndex = nextMatch ? nextMatch.index : cleanMd.length;
    headerRegex.lastIndex = endIndex;

    const content = cleanMd.slice(startIndex, endIndex);

    if (rawTitle.includes('think') || rawTitle.includes('思')) {
      sectionMap.thinking += content;
    } else if (
      rawTitle.includes('tool') ||
      rawTitle.includes('step') ||
      rawTitle.includes('工具')
    ) {
      sectionMap.tools += content;
    } else if (rawTitle.includes('status') || rawTitle.includes('状态')) {
      sectionMap.status += content;
    } else if (rawTitle.includes('answer') || rawTitle.includes('回答')) {
      sectionMap.answer += content;
    } else {
      sectionMap.answer += `\n\n**${match[2]}**\n${content}`;
    }

    if (!nextMatch) break;
    headerRegex.lastIndex = nextMatch.index;
  }

  if (!sectionMap.answer && !sectionMap.thinking && !sectionMap.status) {
    sectionMap.answer = cleanMd;
  }

  return sectionMap;
}

export function renderFeishuCardFromHandlerMarkdown(handlerMarkdown: string): string {
  const { thinking, answer, tools, status } = parseSections(handlerMarkdown);

  const elements: any[] = [];

  let headerTitle = '🤖 AI Assistant';
  let headerColor = 'blue';

  if (trimSafe(answer)) {
    headerTitle = '📝 Answer';
    headerColor = 'blue';
  } else if (trimSafe(tools)) {
    headerTitle = '🧰 Tools / Steps';
    headerColor = 'wathet';
  } else if (trimSafe(thinking)) {
    headerTitle = '🤔 Thinking Process';
    headerColor = 'turquoise';
  }

  if (thinking.trim()) {
    elements.push(collapsiblePanel('💭 Thinking', thinking, false));
  }

  if (tools.trim()) {
    if (elements.length > 0) elements.push({ tag: 'div', text: { tag: 'lark_md', content: ' ' } });
    elements.push(collapsiblePanel('⚙️ Execution', tools, false));
  }

  const finalAnswer = trimSafe(answer);
  if (finalAnswer) {
    if (elements.length > 0) elements.push({ tag: 'hr' });

    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: finalAnswer,
      },
    });
  } else if (!status.trim() && !thinking.trim()) {
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: 'Allocating resources...' },
    });
  }

  if (status.trim()) {
    elements.push({ tag: 'hr' });

    elements.push({
      tag: 'note',
      elements: [{ tag: 'plain_text', content: getStatusWithEmoji(status.trim()) }],
    });
  }

  const card: FeishuCard = {
    config: { wide_screen_mode: true },
    header: {
      template: headerColor,
      title: { tag: 'plain_text', content: headerTitle },
    },
    elements: elements.filter(Boolean),
  };

  return JSON.stringify(card);
}

export class FeishuRenderer {
  render(markdown: string): string {
    return renderFeishuCardFromHandlerMarkdown(markdown);
  }
}
