// Example resource: summary of all accounts
import { getAccounts } from '@actual-app/api/dist/methods.js';
import type { components } from '../../generated/actual-client/types.js';

export async function accountsSummary(): Promise<Array<{ id?: string; name?: string; balance?: number }>> {
  const accounts = await getAccounts();
  return (accounts as components['schemas']['Account'][]).map((a) => {
    // access via optional chaining in case generated types are partial at runtime
    const name = (a as unknown as Record<string, unknown>)?.name;
    const balance = (a as unknown as Record<string, unknown>)?.balance;
    return { id: a.id, name: typeof name === 'string' ? name : undefined, balance: typeof balance === 'number' ? balance : undefined };
  });
}
