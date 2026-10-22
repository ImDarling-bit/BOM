#!/usr/bin/env node
// Gestion des comptes du panneau d'administration.
//
//   node admin-cli.mjs add <identifiant>        crée un compte (mot de passe demandé)
//   node admin-cli.mjs passwd <identifiant>     change le mot de passe
//   node admin-cli.mjs reset-2fa <identifiant>  désactive la double authentification
//   node admin-cli.mjs remove <identifiant>     supprime le compte
//   node admin-cli.mjs list                     liste les comptes
//
// Sur le serveur : sudo -u bom env DB_PATH=/var/lib/bom/bom.db node admin-cli.mjs …

import { createInterface } from 'node:readline';

import * as db from './lib/db.mjs';

/** Lit un mot de passe sans l'afficher. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function askNewPassword() {
  const p1 = await askHidden('Mot de passe (12 caractères minimum) : ');
  if (!db.passwordOk(p1)) throw new Error('Mot de passe trop court (12 caractères minimum).');
  const p2 = await askHidden('Confirme le mot de passe : ');
  if (p1 !== p2) throw new Error('Les deux mots de passe sont différents.');
  return p1;
}

const [cmd, username] = process.argv.slice(2);

try {
  db.openDb();
  switch (cmd) {
    case 'add': {
      if (!db.usernameOk(username))
        throw new Error('Identifiant : 3 à 32 caractères (lettres, chiffres, . _ -).');
      if (db.findAdmin(username)) throw new Error('Ce compte existe déjà.');
      await db.createAdmin(username, await askNewPassword());
      db.audit(username, 'compte créé', 'cli');
      console.log(`Compte « ${username} » créé. Active la double authentification depuis le panneau.`);
      break;
    }
    case 'passwd': {
      const a = db.findAdmin(username);
      if (!a) throw new Error('Compte introuvable.');
      await db.setPassword(a.id, await askNewPassword());
      db.audit(username, 'mot de passe changé', 'cli');
      console.log('Mot de passe changé (redémarre le service pour fermer les sessions ouvertes).');
      break;
    }
    case 'reset-2fa': {
      const a = db.findAdmin(username);
      if (!a) throw new Error('Compte introuvable.');
      db.disableTotp(a.id);
      db.audit(username, '2FA réinitialisée', 'cli');
      console.log('Double authentification désactivée pour ce compte.');
      break;
    }
    case 'remove': {
      if (!db.removeAdmin(username)) throw new Error('Compte introuvable.');
      db.audit(username, 'compte supprimé', 'cli');
      console.log('Compte supprimé.');
      break;
    }
    case 'list': {
      const rows = db.listAdmins();
      if (!rows.length) console.log('Aucun compte.');
      for (const r of rows) {
        const last = r.last_login_at ? new Date(r.last_login_at).toLocaleString('fr-FR') : 'jamais';
        console.log(
          `${r.username.padEnd(20)} 2FA : ${r.totp_enabled ? 'oui' : 'NON'}   dernière connexion : ${last}`,
        );
      }
      break;
    }
    default:
      console.log(
        'Usage : node admin-cli.mjs add|passwd|reset-2fa|remove <identifiant>  |  node admin-cli.mjs list',
      );
      process.exitCode = 1;
  }
} catch (err) {
  console.error(`Erreur : ${err.message}`);
  process.exitCode = 1;
}
