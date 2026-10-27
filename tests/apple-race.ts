// Separate database connection for isolated Apple redemption contention testing only.
import { redeemAppleTransaction } from '../packages/web/src/api/services/apple';
const verifier = { verifyAndDecodeTransaction: async (jws: string) => JSON.parse(jws), verifyAndDecodeNotification: async () => ({}) } as never;
try {
  const result = await redeemAppleTransaction('buyer', process.argv[2]!, verifier);
  console.log(JSON.stringify({ success: true, duplicate: result.duplicate }));
} catch (error) {
  console.log(JSON.stringify({ success: false, message: (error as Error).message.slice(0, 80) }));
}
