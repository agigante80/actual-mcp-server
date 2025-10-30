// Example resource: summary of all accounts
import { getAccounts } from '@actual-app/api/dist/methods.js';

export async function accountsSummary() {
  const accounts = await getAccounts();
  return accounts.map((a: any) => ({ id: a.id, name: a.name, balance: a.balance }));
}
