const admin = require('firebase-admin');
const path = require('path');

const sa = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '../Downloads/prime-sms-hub-661cc-firebase-adminsdk-fbsvc-d4b50bce12.json');

try {
  admin.initializeApp({ credential: admin.credential.cert(require(sa)) });
} catch (e) {
  try {
    admin.initializeApp();
  } catch (err) {
    console.error('Could not initialize admin:', err);
    process.exit(1);
  }
}

const db = admin.firestore();

(async () => {
  const uid = '763KecSUMVW5NDGTJtqBnTIej833';
  console.log('Querying transactions for uid=', uid);
  try {
    const q = db.collection('transactions').where('uid', '==', uid).orderBy('createdAt', 'desc');
    const snap = await q.get();
    console.log('Found', snap.size, 'transactions');
    snap.forEach(doc => {
      console.log(doc.id, doc.data());
    });
    process.exit(0);
  } catch (err) {
    console.error('Error querying transactions:', err);
    process.exit(1);
  }
})();
