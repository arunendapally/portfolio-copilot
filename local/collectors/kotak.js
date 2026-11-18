'use strict';
// Kotak Neo stays in chat (research R6 option B, decided 18-Nov-2026): its API would need the
// engine to hold the investor's MPIN. The local engine reads nothing from Kotak; the chat's QR
// login and reads still feed the same captures, which the engine then uses.

module.exports = function kotak() {
  const detail = 'Kotak Neo is read in chat (QR login), by your choice; the local engine does not connect to it';
  return {
    broker: 'kotak',
    chatOnly: true,
    async status() { return { state: 'chat', detail }; },
    async login() { return { state: 'chat', detail }; },
    async pull() { return { written: [], partial: [], errors: [], state: 'chat' }; },
  };
};
