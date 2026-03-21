// backend/sync-transactions-to-users.js
// Usage:
// 1) Dry run (default): node sync-transactions-to-users.js
// 2) Apply changes: node sync-transactions-to-users.js --apply
// 3) Also recompute wallet from transactions: node sync-transactions-to-users.js --apply --recompute-wallet

import admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin either from GOOGLE_APPLICATION_CREDENTIALS or local serviceAccountKey.json
try {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
  } else {
    const saPath = path.join(__dirname, 'serviceAccountKey.json');
    if (fs.existsSync(saPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } else {
      console.error('\nERROR: Could not find serviceAccountKey.json and GOOGLE_APPLICATION_CREDENTIALS is not set.');
      console.error('Place serviceAccountKey.json in the backend/ folder, or set GOOGLE_APPLICATION_CREDENTIALS to its path.');
      process.exit(1);
    }
  }
} catch (err) {
  console.error('\nERROR: Could not initialize Firebase Admin.');
  console.error(err);
  process.exit(1);
}

const db = admin.firestore();

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const RECOMPUTE_WALLET = args.includes('--recompute-wallet') || args.includes('--recompute');

const run = async () => {
  console.log('\nStarting transaction -> user sync');
  console.log(`Mode: ${APPLY ? 'APPLY (writes will be performed)' : 'DRY RUN (no writes)'}`);
  if (RECOMPUTE_WALLET) console.log('Wallet recompute: ENABLED');

  try {
    const txSnap = await db.collection('transactions').get();
    console.log(`Found ${txSnap.size} transactions`);

    const byUid = new Map();

    txSnap.forEach(doc => {
      const data = doc.data();
      const uid = data.uid;
      if (!uid) return;
      if (!byUid.has(uid)) byUid.set(uid, []);
      byUid.get(uid).push({
        id: doc.id,
        amount: Number(data.amount || 0),
        type: data.type || 'credit',
        currency: data.currency || null,
        originalCurrency: data.originalCurrency || null,
        originalAmount: data.originalAmount !== undefined ? Number(data.originalAmount) : null
      });
    });

    console.log(`Found transactions for ${byUid.size} users`);

    for (const [uid, txs] of byUid.entries()) {
      const userRef = db.collection('users').doc(uid);
      const userSnap = await userRef.get();
      const existing = userSnap.exists ? (userSnap.data().transactions || []) : [];

      const txIds = txs.map(t => t.id);
      const missing = txIds.filter(id => !existing.includes(id));

      if (missing.length === 0 && !RECOMPUTE_WALLET) {
        console.log(`UID ${uid}: no missing txs`);
        continue;
      }

      console.log(`\nUID ${uid}: totalTxs=${txIds.length} existingOnUser=${existing.length} missing=${missing.length}`);
      if (missing.length > 0) console.log('Missing tx ids:', missing.slice(0, 20));

      if (RECOMPUTE_WALLET) {
        // compute wallet = sum(credits) - sum(debits) (convert KES -> USD when possible)
        const KES_TO_USD_RATE = 0.0077;
        let balance = 0;
        txs.forEach(t => {
          const rawAmt = Number(t.amount || 0);
          let amtUSD = rawAmt;

          // Prefer converting originalAmount when originalCurrency is set
          if (t.originalCurrency === 'KES' && t.originalAmount != null) {
            amtUSD = Number(t.originalAmount) * KES_TO_USD_RATE;
          } else if (t.currency === 'KES') {
            amtUSD = rawAmt * KES_TO_USD_RATE;
          } else if (t.currency === 'USD') {
            amtUSD = rawAmt;
          } else if (t.originalCurrency === 'USD' && t.originalAmount != null) {
            amtUSD = Number(t.originalAmount);
          } else {
            // Fallback: assume stored amount is USD
            amtUSD = rawAmt;
          }

          if (t.type === 'debit') balance -= amtUSD;
          else balance += amtUSD;
        });
        console.log(`Recomputed wallet for ${uid}: ${balance.toFixed(2)}`);

        if (APPLY) {
          const updates = {};
          if (missing.length > 0) updates.transactions = admin.firestore.FieldValue.arrayUnion(...missing);
          updates.wallet = Number(balance.toFixed(2));
          updates.lastTransactionAt = admin.firestore.FieldValue.serverTimestamp();

          await userRef.set(updates, { merge: true });
          console.log(` => Applied missing txs + wallet update for ${uid}`);
        } else {
          console.log(' => DRY RUN: not writing changes');
        }
      } else {
        if (missing.length > 0) {
          if (APPLY) {
            await userRef.update({
              transactions: admin.firestore.FieldValue.arrayUnion(...missing),
              lastTransactionAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(` => Appended ${missing.length} tx ids to user ${uid}`);
          } else {
            console.log(' => DRY RUN: would append tx ids to user');
          }
        }
      }
    }

    console.log('\nSync complete');
    console.log('\nSync complete');
    process.exit(0);
  } catch (err) {
    console.error('Error during sync:', err);
    process.exit(1);
  }
};

run();
