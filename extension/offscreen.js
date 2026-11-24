'use strict';

/* ══════════════════════════════════════════════════════════════════
   隐藏文档里唯一的工作：把剪贴板里的密码覆盖掉。

   两条都是实测出来的，不是猜的（Chrome 156）：
   1) navigator.clipboard.writeText() 在隐藏文档里必然抛
      "Document is not focused" —— 隐藏文档永远拿不到焦点，这条路走不通；
   2) document.execCommand('copy') 对**空选区**是静默空操作 —— 它返回
      true，剪贴板却纹丝不动。原来的代码正是这么写的，所以"清空"看起来
      成功、实际什么也没发生。
   所以必须给一块非空的覆盖内容：这里用零宽空格（U+200B）。
   粘出来看不见，效果等同于清空，又不违反"没焦点不能写"的限制。
   ══════════════════════════════════════════════════════════════════ */

const SENTINEL = '\u200B';   // 零宽空格：看不见的覆盖字符

function copyViaExecCommand(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.setAttribute('aria-hidden', 'true');
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;border:0;padding:0;margin:0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

async function wipeOnce() {
  /* execCommand 是主路：它不需要焦点，这正是隐藏文档唯一能用的写法 */
  if (copyViaExecCommand(SENTINEL)) return true;
  /* 兜底：万一哪天 Chrome 又允许隐藏文档用新 API */
  try { await navigator.clipboard.writeText(SENTINEL); return true; } catch (e) { return false; }
}

async function wipe() {
  if (await wipeOnce()) return true;
  /* 给一次重试的机会：偶尔第一次会撞上文档还没就绪 */
  await new Promise(r => setTimeout(r, 150));
  return wipeOnce();
}

chrome.runtime.onMessage.addListener(msg => {
  if (!msg || msg.type !== 'cast:wipe') return;
  wipe().then(ok => {
    chrome.runtime.sendMessage({ type: 'cast:wipe-done', ok }).catch(() => {});
  });
});
