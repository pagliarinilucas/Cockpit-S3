/**
 * Create or reset a user from the CLI:
 *   bun run seed <username> <password> [admin|user]
 */
import { usersStore } from '../users/store';
import { sessions } from '../auth/sessions';
import type { Role } from '../types';

const [username, password, roleArg] = process.argv.slice(2);
const role: Role = roleArg === 'admin' ? 'admin' : 'user';

if (!username || !password) {
  console.error('uso: bun run seed <username> <password> [admin|user]');
  process.exit(1);
}
if (password.length < 6) {
  console.error('senha precisa de >= 6 caracteres');
  process.exit(1);
}

if (usersStore.exists(username)) {
  await usersStore.setPassword(username, password);
  usersStore.setRole(username, role);
  sessions.revokeAllForUser(username);
  console.log(`usuário "${username}" atualizado (role=${role}, sessões revogadas)`);
} else {
  await usersStore.create(username, password, role);
  console.log(`usuário "${username}" criado (role=${role})`);
}
process.exit(0);
