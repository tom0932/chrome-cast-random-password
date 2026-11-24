'use strict';

/* ══════════════════════════════════════════════════════════════════
   后台：只干一件事 —— popup 关掉之后，把"30 秒后清空剪贴板"这件事
   做完。popup 里的 setTimeout 会随弹窗销毁，所以计时必须挪到这里。
   ══════════════════════════════════════════════════════════════════ */

const ALARM = 'cast:wipe';

chrome.runtime.onMessage.addListener(msg => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'cast:schedule-wipe') {
    /* 30 秒是 Chrome 对扩展计时器的下限（0.5 分钟），正好够用。
       同名闹钟会被替换 —— 也就是每复制一次就重新计时 30 秒 */
    chrome.alarms.create(ALARM, { delayInMinutes: 0.5 });
    console.log('[CAST] 已排定 30 秒后覆盖剪贴板');
  } else if (msg.type === 'cast:cancel-wipe') {
    chrome.alarms.clear(ALARM);
  } else if (msg.type === 'cast:wipe-done') {
    /* 隐藏文档写完回执，这时才收走它 —— 不靠猜时间 */
    console.log('[CAST] 剪贴板覆盖' + (msg.ok ? '成功' : '失败（无焦点写不进剪贴板）'));
    closeOffscreen();
  }
});

chrome.alarms.onAlarm.addListener(async a => {
  if (a.name !== ALARM) return;
  console.log('[CAST] 闹钟到点，开始覆盖剪贴板');
  try {
    await ensureOffscreen();
    await chrome.runtime.sendMessage({ type: 'cast:wipe' });
  } catch (e) {
    /* sendMessage 在没有接收方时会 reject，但消息通常已经送达；
       真拿不到剪贴板就放弃，不打扰用户 */
  }
});

async function hasOffscreen() {
  try {
    if (chrome.runtime.getContexts) {
      const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      return ctx.length > 0;
    }
    if (chrome.offscreen.hasDocument) return await chrome.offscreen.hasDocument();
  } catch (e) { /* 判断不了就往下走，靠 createDocument 的报错兜底 */ }
  return false;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  const create = () => chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['CLIPBOARD'],
    justification: '复制密码 30 秒后把剪贴板覆盖掉，避免密码长期留在系统里'
  });
  try {
    await create();
  } catch (e) {
    /* 可能是并发创建撞车：已经存在就算了，等一下再确认一次 */
    await new Promise(r => setTimeout(r, 120));
    if (!(await hasOffscreen())) throw e;
  }
}

function closeOffscreen() {
  if (chrome.offscreen && chrome.offscreen.closeDocument) {
    chrome.offscreen.closeDocument().catch(() => {});
  }
}
