import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Vanilla 1.21.1 can leave crafting output unchanged between ingredient clicks.
// Mineflayer 4.39 waits for updateSlot:0 even then, leaving a half-filled grid.
// A deliberately stale stateId asks vanilla for a full, authoritative window
// resync after the ordinary click. It does not grant items or bypass recipes.
export function installInventorySync(bot) {
  if (bot.version !== '1.21.1' || bot.colonyInventorySync) return;
  const Item = require('prismarine-item')(bot.registry);
  bot.colonyInventorySync = true;
  let queue = Promise.resolve();
  bot.clickWindow = (slot, mouseButton, mode) => {
    const operation = queue.then(() => confirmedClick(bot, Item, slot, mouseButton, mode));
    queue = operation.catch(() => {});
    return operation;
  };
}

export function confirmedClick(bot, Item, slot, mouseButton, mode, timeoutMs = 5000) {
  const window = bot.currentWindow || bot.inventory;
  if (!window || !Number.isInteger(slot) || !Number.isInteger(mode) || mode < 0 || mode > 6) return Promise.reject(new Error('Invalid inventory click'));
  return new Promise((resolve, reject) => {
    const event = `setWindowItems:${window.id}`;
    const cleanup = () => { clearTimeout(timer); bot.off(event, done); bot.off('end', ended); };
    const done = () => { cleanup(); resolve(); };
    const ended = () => { cleanup(); reject(new Error('Minecraft disconnected during inventory click')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Server did not confirm inventory click')); }, timeoutMs);
    bot.once(event, done); bot.once('end', ended);
    try {
      bot._client.write('window_click', {windowId:window.id,stateId:-1,slot,mouseButton,mode,changedSlots:[],cursorItem:Item.toNotch(window.selectedItem)});
    } catch (error) { cleanup(); reject(error); }
  });
}
