/**
 * Fake Data Generator for Actual Budget Testing
 * Creates realistic financial data for comprehensive MCP tool testing
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Account {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit' | 'investment';
  balance: number;
}

interface Category {
  id: string;
  name: string;
  groupId: string;
  budgeted?: number;
}

interface CategoryGroup {
  id: string;
  name: string;
}

interface Payee {
  id: string;
  name: string;
}

interface Transaction {
  id: string;
  accountId: string;
  payeeId: string;
  categoryId: string;
  amount: number; // in cents
  date: string;
  notes?: string;
}

class FakeDataGenerator {
  private accounts: Account[] = [];
  private categoryGroups: CategoryGroup[] = [];
  private categories: Category[] = [];
  private payees: Payee[] = [];
  private transactions: Transaction[] = [];

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private generateAccounts(): void {
    const accountTypes = [
      { name: 'Main Checking', type: 'checking', balance: 350000 }, // $3,500
      { name: 'Savings Account', type: 'savings', balance: 1250000 }, // $12,500
      { name: 'Credit Card', type: 'credit', balance: -45000 }, // -$450
      { name: 'Investment Account', type: 'investment', balance: 850000 }, // $8,500
      { name: 'Emergency Fund', type: 'savings', balance: 500000 }, // $5,000
    ];

    this.accounts = accountTypes.map(acc => ({
      id: this.generateId(),
      name: acc.name,
      type: acc.type as any,
      balance: acc.balance
    }));

    console.log(`Generated ${this.accounts.length} accounts`);
  }

  private generateCategories(): void {
    const groupsAndCategories = [
      {
        group: 'Monthly Bills',
        categories: [
          { name: 'Rent/Mortgage', budgeted: 150000 },
          { name: 'Utilities', budgeted: 25000 },
          { name: 'Internet', budgeted: 8000 },
          { name: 'Phone', budgeted: 12000 },
        ]
      },
      {
        group: 'Everyday Expenses',
        categories: [
          { name: 'Groceries', budgeted: 60000 },
          { name: 'Gas', budgeted: 20000 },
          { name: 'Restaurants', budgeted: 30000 },
          { name: 'Shopping', budgeted: 15000 },
        ]
      },
      {
        group: 'Savings & Goals',
        categories: [
          { name: 'Emergency Fund', budgeted: 50000 },
          { name: 'Vacation', budgeted: 20000 },
          { name: 'Car Replacement', budgeted: 30000 },
        ]
      },
      {
        group: 'Entertainment',
        categories: [
          { name: 'Movies & Shows', budgeted: 15000 },
          { name: 'Hobbies', budgeted: 25000 },
          { name: 'Books', budgeted: 5000 },
        ]
      }
    ];

    this.categoryGroups = [];
    this.categories = [];

    groupsAndCategories.forEach(group => {
      const groupId = this.generateId();
      this.categoryGroups.push({
        id: groupId,
        name: group.group
      });

      group.categories.forEach(cat => {
        this.categories.push({
          id: this.generateId(),
          name: cat.name,
          groupId: groupId,
          budgeted: cat.budgeted
        });
      });
    });

    console.log(`Generated ${this.categoryGroups.length} category groups with ${this.categories.length} categories`);
  }

  private generatePayees(): void {
    const payeeNames = [
      'Amazon', 'Walmart', 'Target', 'Costco', 'Starbucks',
      'McDonald\'s', 'Shell Gas Station', 'AT&T', 'Electric Company',
      'Water Utility', 'Internet Provider', 'Landlord Properties',
      'Local Grocery Store', 'Netflix', 'Spotify', 'Gym Membership',
      'Doctor\'s Office', 'Pharmacy', 'Auto Repair Shop', 'Insurance Company',
      'Bank Transfer', 'Employer Direct Deposit', 'Cash ATM', 'Venmo',
      'Local Restaurant', 'Coffee Shop', 'Bookstore', 'Gas Station',
    ];

    this.payees = payeeNames.map(name => ({
      id: this.generateId(),
      name: name
    }));

    console.log(`Generated ${this.payees.length} payees`);
  }

  private generateTransactions(): void {
    // Generate transactions for the last 90 days
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 90);

    this.transactions = [];

    // Generate regular monthly transactions (bills, etc.)
    this.generateRegularTransactions(startDate, endDate);
    
    // Generate random everyday transactions
    this.generateRandomTransactions(startDate, endDate);

    console.log(`Generated ${this.transactions.length} transactions`);
  }

  private generateRegularTransactions(startDate: Date, endDate: Date): void {
    const regularTransactions = [
      { payee: 'Employer Direct Deposit', category: 'Income', amount: 450000, frequency: 15 }, // Bi-weekly salary
      { payee: 'Landlord Properties', category: 'Rent/Mortgage', amount: -150000, frequency: 30 },
      { payee: 'Electric Company', category: 'Utilities', amount: -12000, frequency: 30 },
      { payee: 'Internet Provider', category: 'Internet', amount: -8000, frequency: 30 },
      { payee: 'AT&T', category: 'Phone', amount: -12000, frequency: 30 },
      { payee: 'Netflix', category: 'Movies & Shows', amount: -1500, frequency: 30 },
      { payee: 'Spotify', category: 'Movies & Shows', amount: -1000, frequency: 30 },
      { payee: 'Gym Membership', category: 'Hobbies', amount: -5000, frequency: 30 },
    ];

    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      regularTransactions.forEach(txn => {
        if (Math.random() > 0.1) { // 90% chance of transaction occurring
          const account = txn.amount > 0 ? 
            this.accounts.find(a => a.type === 'checking') : // Income goes to checking
            this.accounts[Math.floor(Math.random() * this.accounts.length)]; // Expenses from any account
          
          const payee = this.payees.find(p => p.name === txn.payee);
          const category = this.categories.find(c => c.name === txn.category);
          
          if (account && payee && category) {
            this.transactions.push({
              id: this.generateId(),
              accountId: account.id,
              payeeId: payee.id,
              categoryId: category.id,
              amount: txn.amount + Math.floor(Math.random() * 2000 - 1000), // Add some variance
              date: currentDate.toISOString().split('T')[0],
              notes: `Regular ${txn.frequency}-day transaction`
            });
          }
        }
        
        currentDate.setDate(currentDate.getDate() + txn.frequency);
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  private generateRandomTransactions(startDate: Date, endDate: Date): void {
    const randomTransactionTypes = [
      { categories: ['Groceries'], payees: ['Walmart', 'Target', 'Local Grocery Store'], amountRange: [-8000, -15000] },
      { categories: ['Gas'], payees: ['Shell Gas Station', 'Gas Station'], amountRange: [-3000, -7000] },
      { categories: ['Restaurants'], payees: ['McDonald\'s', 'Local Restaurant', 'Starbucks'], amountRange: [-1500, -4500] },
      { categories: ['Shopping'], payees: ['Amazon', 'Target', 'Costco'], amountRange: [-2000, -12000] },
      { categories: ['Hobbies'], payees: ['Bookstore', 'Amazon'], amountRange: [-1000, -5000] },
      { categories: ['Emergency Fund'], payees: ['Bank Transfer'], amountRange: [10000, 50000] }, // Savings transfers
    ];

    // Generate 3-8 random transactions per day
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const transactionsToday = Math.floor(Math.random() * 6) + 3; // 3-8 transactions
      
      for (let i = 0; i < transactionsToday; i++) {
        const txnType = randomTransactionTypes[Math.floor(Math.random() * randomTransactionTypes.length)];
        const category = this.categories.find(c => txnType.categories.includes(c.name));
        const payeeName = txnType.payees[Math.floor(Math.random() * txnType.payees.length)];
        const payee = this.payees.find(p => p.name === payeeName);
        
        let account;
        if (txnType.amountRange[0] > 0) {
          // Positive amount (transfer/income) - use savings or checking
          account = this.accounts.find(a => a.type === 'savings' || a.type === 'checking');
        } else {
          // Negative amount (expense) - use any account
          account = this.accounts[Math.floor(Math.random() * this.accounts.length)];
        }
        
        if (category && payee && account) {
          const amount = Math.floor(Math.random() * (txnType.amountRange[1] - txnType.amountRange[0])) + txnType.amountRange[0];
          
          this.transactions.push({
            id: this.generateId(),
            accountId: account.id,
            payeeId: payee.id,
            categoryId: category.id,
            amount: amount,
            date: currentDate.toISOString().split('T')[0],
            notes: Math.random() > 0.7 ? `Random transaction at ${payee.name}` : undefined
          });
        }
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  async generateAllData(): Promise<any> {
    console.log('🎲 Generating fake financial data...');
    
    this.generateAccounts();
    this.generateCategories();
    this.generatePayees();
    this.generateTransactions();
    
    // Create the data structure that Actual expects
    const fakeData = {
      accounts: this.accounts,
      categoryGroups: this.categoryGroups,
      categories: this.categories,
      payees: this.payees,
      transactions: this.transactions,
      summary: {
        accountCount: this.accounts.length,
        categoryCount: this.categories.length,
        payeeCount: this.payees.length,
        transactionCount: this.transactions.length,
        dateRange: {
          start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          end: new Date().toISOString().split('T')[0]
        }
      }
    };
    
    // Save to file for inspection
    const outputPath = path.join(__dirname, 'fake-data-output.json');
    await fs.writeFile(outputPath, JSON.stringify(fakeData, null, 2));
    
    console.log('✅ Fake data generated successfully!');
    console.log(`📊 Summary:`);
    console.log(`   - ${fakeData.accounts.length} accounts`);
    console.log(`   - ${fakeData.categoryGroups.length} category groups`);
    console.log(`   - ${fakeData.categories.length} categories`);
    console.log(`   - ${fakeData.payees.length} payees`);
    console.log(`   - ${fakeData.transactions.length} transactions`);
    console.log(`📁 Data saved to: ${outputPath}`);
    
    return fakeData;
  }
}

// Export the data for use by the test script
export { FakeDataGenerator };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const generator = new FakeDataGenerator();
  generator.generateAllData().catch(console.error);
}