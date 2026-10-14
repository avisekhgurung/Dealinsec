import { mailboxStoreContract } from "./mailbox-store.contract";
import { MemoryMailboxStore } from "./memory-store";

let store = new MemoryMailboxStore();
mailboxStoreContract("in memory", {
  store: () => (store = new MemoryMailboxStore()),
  rawEnvelope: async (id) => store.rows.find((r) => r.id === id)?.refreshTokenEnc ?? null,
});
