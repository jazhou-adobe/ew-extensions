// Prints the App Builder State key of one author's connection, so a maintainer can purge it:
//   node scripts/connection-key.mjs <ims-user-id> <provider-id>
//   env -u CI aio app state delete <printed key>
// The IMS user id is the `userId` field of the request log lines (`aio app logs`). Nothing is read or deleted here.
import { pathToFileURL } from 'node:url';
import { connKeyOf } from '../shell/connections.js';

export const stateKeyFor = (userId, providerId) => `multi-dam-picker.conn.v1.${connKeyOf(userId, providerId)}`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [userId, providerId] = process.argv.slice(2);
  if (!userId || !providerId) {
    console.error('usage: node scripts/connection-key.mjs <ims-user-id> <provider-id>');
    process.exit(1);
  }
  console.log(stateKeyFor(userId, providerId));
}
