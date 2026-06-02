import { config } from './config';
import { usersStore } from './users/store';

/** Create an initial admin on first boot so the system is reachable. */
export async function bootstrap(): Promise<void> {
  if (usersStore.count() > 0) return;

  let pass = config.adminPass;
  let generated = false;
  if (!pass) {
    pass = Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('base64url');
    generated = true;
  }
  await usersStore.create(config.adminUser, pass, 'admin');

  console.log('────────────────────────────────────────');
  console.log(`  Admin inicial criado: ${config.adminUser}`);
  if (generated) console.log(`  Senha (gerada, anote!): ${pass}`);
  else console.log('  Senha: (a definida em ADMIN_PASSWORD)');
  console.log('────────────────────────────────────────');
}
