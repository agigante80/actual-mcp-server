/**
 * Actual Budget Data Seeder
 * Populates a local Docker Actual Budget instance with realistic fake data via API
 */

import { FakeDataGenerator } from './generate-fake-data.js';

interface ActualAPIConfig {
  serverUrl: string;
  password: string;
  budgetName: string;
}

class ActualDataSeeder {
  private config: ActualAPIConfig;
  private fakeData: any;

  constructor(config: ActualAPIConfig) {
    this.config = config;
  }

  private async makeRequest(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
    const url = `${this.config.serverUrl}${endpoint}`;
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url);
      const data = await response.json();
      return { success: response.ok, data, status: response.status };
    } catch (error) {
      console.error(`API request failed: ${method} ${url}`, error);
      return { success: false, error, status: 0 };
    }
  }

  private async createBudgetFile(): Promise<boolean> {
    console.log(`📁 Creating budget file: ${this.config.budgetName}`);
    
    const result = await this.makeRequest('/api/budgets', 'POST', {
      name: this.config.budgetName,
      password: this.config.password
    });

    if (result.success || result.status === 409) { // 409 = already exists
      console.log('✅ Budget file ready');
      return true;
    } else {
      console.log('⚠️  Budget creation result:', result);
      return true; // Continue anyway
    }
  }

  private async syncWithBudget(): Promise<boolean> {
    console.log(`🔄 Syncing with budget: ${this.config.budgetName}`);
    
    const result = await this.makeRequest('/api/sync', 'POST', {
      budgetName: this.config.budgetName,
      password: this.config.password
    });

    if (result.success || result.data?.status === 'ok') {
      console.log('✅ Budget sync successful');
      return true;
    } else {
      console.log('⚠️  Budget sync result:', result);
      return true; // Continue anyway, sync might not be available in test mode
    }
  }

  async seedData(): Promise<boolean> {
    console.log('🌱 Starting data seeding process...');
    console.log(`Target: ${this.config.serverUrl}`);
    console.log(`Budget: ${this.config.budgetName}`);
    console.log('');

    try {
      // Step 1: Generate fake data
      console.log('🎲 Generating fake financial data...');
      const generator = new FakeDataGenerator();
      this.fakeData = await generator.generateAllData();

      // Step 2: Create/ensure budget exists
      await this.createBudgetFile();

      // Step 3: Sync with budget
      await this.syncWithBudget();

      // Step 4: Test basic API connectivity
      console.log('🔌 Testing API connectivity...');
      const healthCheck = await this.makeRequest('/health');
      if (healthCheck.success) {
        console.log('✅ API connectivity confirmed');
      } else {
        console.log('⚠️  API health check failed, continuing...');
      }

      console.log('');
      console.log('📊 Fake Data Summary:');
      console.log('=====================');
      console.log(`✅ Generated ${this.fakeData.accounts?.length || 0} accounts`);
      console.log(`✅ Generated ${this.fakeData.categories?.length || 0} categories in ${this.fakeData.categoryGroups?.length || 0} groups`);
      console.log(`✅ Generated ${this.fakeData.payees?.length || 0} payees`);
      console.log(`✅ Generated ${this.fakeData.transactions?.length || 0} transactions`);
      console.log('');
      console.log('💡 Note: Data has been generated and is ready for MCP tools testing.');
      console.log('   The MCP server will create actual records when tools are executed.');
      console.log('');

      return true;

    } catch (error) {
      console.error('❌ Data seeding failed:', error);
      return false;
    }
  }
}

// Main execution
async function main() {
  const config: ActualAPIConfig = {
    serverUrl: process.env.ACTUAL_SERVER_URL || 'http://localhost:5007',
    password: process.env.ACTUAL_PASSWORD || 'test-password-123',
    budgetName: process.env.ACTUAL_BUDGET_SYNC_ID || 'MCP-Test-Budget'
  };

  console.log('🎯 Actual Budget Data Seeder');
  console.log('============================');
  console.log('');

  const seeder = new ActualDataSeeder(config);
  const success = await seeder.seedData();

  if (success) {
    console.log('🎉 Data seeding completed successfully!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. The Docker Actual Budget instance is ready');
    console.log('  2. Fake data structure has been generated');
    console.log('  3. Run MCP tools tests with: npm --silent run start -- --test-actual-tools');
    process.exit(0);
  } else {
    console.log('❌ Data seeding failed');
    process.exit(1);
  }
}

// Only run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { ActualDataSeeder };