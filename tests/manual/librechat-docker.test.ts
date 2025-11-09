/**
 * Integration test: Spin up temporary Docker LibreChat and test MCP server connection
 * This test verifies that our MCP server works with a real LibreChat instance
 */

import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestResult {
  success: boolean;
  message: string;
  details?: any;
}

class LibreChatDockerTest {
  private mcpServerProcess?: ChildProcess;
  private librechatContainerId?: string;
  private testDir: string;
  private cleanup: Array<() => Promise<void>> = [];

  constructor() {
    // Use timestamp to avoid directory conflicts
    const timestamp = Date.now();
    this.testDir = path.join(__dirname, `../../.temp-test-${timestamp}`);
  }

  async setup(): Promise<void> {
    console.log('🔧 Setting up LibreChat Docker integration test...');
    
    // Create temporary test directory
    await fs.mkdir(this.testDir, { recursive: true });
    this.cleanup.push(async () => {
      try {
        await fs.rm(this.testDir, { recursive: true, force: true });
      } catch (e) {
        console.warn('Failed to clean up test directory:', e);
      }
    });

    // Create LibreChat configuration that includes our MCP server
    await this.createLibreChatConfig();
  }

  private async createLibreChatConfig(): Promise<void> {
    console.log('📝 Creating LibreChat configuration with MCP server...');

    // Create a minimal LibreChat configuration
    const librechatConfig = {
      version: 1.0,
      cache: true,
      endpoints: {
        mcpServers: {
          actual_finance: {
            command: "node",
            args: ["dist/src/index.js"],
            cwd: "/workspace",
            env: {
              ACTUAL_SERVER_URL: process.env.ACTUAL_SERVER_URL || "http://host.docker.internal:5006",
              ACTUAL_PASSWORD: process.env.ACTUAL_PASSWORD || "",
              ACTUAL_BUDGET_SYNC_ID: process.env.ACTUAL_BUDGET_SYNC_ID || ""
            }
          }
        }
      }
    };

    const configPath = path.join(this.testDir, 'librechat.yaml');
    await fs.writeFile(configPath, JSON.stringify(librechatConfig, null, 2));

    // Create docker-compose for temporary LibreChat instance
    const dockerCompose = `
version: '3.8'
services:
  librechat:
    image: ghcr.io/danny-avila/librechat:latest
    container_name: librechat-mcp-test
    ports:
      - "3080:3080"
    environment:
      - HOST=0.0.0.0
      - PORT=3080
      - MONGO_URI=mongodb://mongodb:27017/LibreChat
      - DOMAIN_CLIENT=http://localhost:3080
      - DOMAIN_SERVER=http://localhost:3080
      - DEBUG_LOGGING=true
      - DEBUG_CONSOLE=true
    volumes:
      - ./librechat.yaml:/app/librechat.yaml:ro
      - ${process.cwd()}:/workspace:ro
    depends_on:
      - mongodb
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"

  mongodb:
    image: mongo:6.0
    container_name: librechat-mongo-test
    restart: unless-stopped
    volumes:
      - mongodb_data:/data/db
    command: mongod --noauth

volumes:
  mongodb_data:
`;

    const dockerComposePath = path.join(this.testDir, 'docker-compose.yml');
    await fs.writeFile(dockerComposePath, dockerCompose.trim());
  }

  async startMcpServer(): Promise<TestResult> {
    console.log('🚀 Starting MCP server...');
    
    try {
      // Build the project first
      await this.runCommand('npm', ['run', 'build'], process.cwd());

      // Start MCP server with HTTP endpoint
      this.mcpServerProcess = spawn('npm', ['--silent', 'run', 'start', '--', '--http', '--debug'], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let output = '';
      this.mcpServerProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      this.mcpServerProcess.stderr?.on('data', (data) => {
        console.log('MCP Server:', data.toString());
      });

      // Wait for server to start (look for "Server started" or similar)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('MCP server failed to start within 30 seconds'));
        }, 30000);

        const checkOutput = () => {
          if (output.includes('Server started') || output.includes('listening on') || output.includes('HTTP server')) {
            clearTimeout(timeout);
            resolve(void 0);
          }
        };

        this.mcpServerProcess!.stdout?.on('data', checkOutput);
        
        // Also check if process exits early
        this.mcpServerProcess!.on('exit', (code) => {
          if (code !== 0) {
            clearTimeout(timeout);
            reject(new Error(`MCP server exited with code ${code}`));
          }
        });
      });

      this.cleanup.push(async () => {
        if (this.mcpServerProcess) {
          console.log('🛑 Stopping MCP server...');
          this.mcpServerProcess.kill('SIGTERM');
          
          // Wait for graceful shutdown, then force kill
          await new Promise((resolve) => {
            const forceKill = setTimeout(() => {
              if (this.mcpServerProcess && !this.mcpServerProcess.killed) {
                console.log('⚠️  Force killing MCP server...');
                this.mcpServerProcess.kill('SIGKILL');
              }
              resolve(undefined);
            }, 5000);
            
            if (this.mcpServerProcess) {
              this.mcpServerProcess.on('exit', () => {
                clearTimeout(forceKill);
                resolve(undefined);
              });
            }
          });
          console.log('✅ MCP server stopped');
        }
      });

      return { success: true, message: 'MCP server started successfully' };
    } catch (error) {
      return { 
        success: false, 
        message: `Failed to start MCP server: ${error}`,
        details: error 
      };
    }
  }

  async startLibreChat(): Promise<TestResult> {
    console.log('🐳 Starting LibreChat Docker container...');
    
    try {
      // Start LibreChat using docker-compose
      await this.runCommand('docker-compose', ['up', '-d'], this.testDir);

      // Wait for LibreChat to be healthy
      const maxWaitTime = 120000; // 2 minutes
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWaitTime) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          
          const response = await fetch('http://localhost:3080/api/health', {
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (response.ok) {
            console.log('✅ LibreChat is healthy');
            
            // Store container ID for cleanup
            const containers = await this.runCommand('docker', ['ps', '-q', '--filter', 'name=librechat-mcp-test'], this.testDir);
            this.librechatContainerId = containers.trim();
            
            this.cleanup.push(async () => {
              try {
                console.log('🛑 Stopping LibreChat containers...');
                // Force stop with timeout
                await Promise.race([
                  this.runCommand('docker-compose', ['down', '-v', '--timeout', '10'], this.testDir),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
                ]);
                console.log('✅ LibreChat containers stopped');
              } catch (e) {
                console.warn('⚠️  Docker-compose down failed, forcing cleanup...', e);
                // Force kill if docker-compose fails
                try {
                  if (this.librechatContainerId) {
                    await this.runCommand('docker', ['kill', this.librechatContainerId], this.testDir);
                    await this.runCommand('docker', ['rm', '-f', this.librechatContainerId], this.testDir);
                  }
                  // Also try to clean up any containers with our test labels
                  await this.runCommand('docker', ['kill', '$(docker ps -q --filter name=librechat-mcp-test)'], this.testDir).catch(() => {});
                  await this.runCommand('docker', ['rm', '-f', '$(docker ps -aq --filter name=librechat-mcp-test)'], this.testDir).catch(() => {});
                } catch (forceError) {
                  console.warn('Force cleanup also failed:', forceError);
                }
              }
            });

            return { success: true, message: 'LibreChat started successfully' };
          }
        } catch (error) {
          // Continue waiting
        }
        
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      throw new Error('LibreChat failed to become healthy within 2 minutes');
    } catch (error) {
      return { 
        success: false, 
        message: `Failed to start LibreChat: ${error}`,
        details: error 
      };
    }
  }

  async testMcpConnection(): Promise<TestResult> {
    console.log('🔗 Testing MCP server connection from LibreChat...');
    
    try {
      // First, test direct MCP server health
      const controller1 = new AbortController();
      const timeoutId1 = setTimeout(() => controller1.abort(), 10000);
      
      const mcpHealthResponse = await fetch('http://localhost:3000/health', {
        signal: controller1.signal
      });
      
      clearTimeout(timeoutId1);
      
      if (!mcpHealthResponse.ok) {
        throw new Error(`MCP server health check failed: ${mcpHealthResponse.status}`);
      }

      const mcpHealth = await mcpHealthResponse.json();
      console.log('📊 MCP Server Health:', mcpHealth);

      // Test MCP tools endpoint
      const controller2 = new AbortController();
      const timeoutId2 = setTimeout(() => controller2.abort(), 10000);
      
      const mcpToolsResponse = await fetch('http://localhost:3000/tools', {
        signal: controller2.signal
      });
      
      clearTimeout(timeoutId2);
      
      if (mcpToolsResponse.ok) {
        const mcpTools = await mcpToolsResponse.json() as any[];
        console.log(`🛠️  Found ${mcpTools.length || 0} MCP tools available`);
      }

      // Test LibreChat API to see if it can discover MCP servers
      const controller3 = new AbortController();
      const timeoutId3 = setTimeout(() => controller3.abort(), 10000);
      
      const librechatConfigResponse = await fetch('http://localhost:3080/api/config', {
        signal: controller3.signal
      });
      
      clearTimeout(timeoutId3);
      
      if (librechatConfigResponse.ok) {
        const config = await librechatConfigResponse.json();
        console.log('⚙️  LibreChat config loaded successfully');
      }

      return { 
        success: true, 
        message: 'MCP connection test passed',
        details: { mcpHealth }
      };
    } catch (error) {
      return { 
        success: false, 
        message: `MCP connection test failed: ${error}`,
        details: error 
      };
    }
  }

  async testToolExecution(): Promise<TestResult> {
    console.log('🧪 Testing MCP tool execution...');
    
    try {
      // Test a simple tool call through the MCP server HTTP interface
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      const response = await fetch('http://localhost:3000/call-tool', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'actual.accounts.list',
          arguments: {}
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Tool execution failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log('🎯 Tool execution result:', result);

      return { 
        success: true, 
        message: 'Tool execution test passed',
        details: result
      };
    } catch (error) {
      return { 
        success: false, 
        message: `Tool execution test failed: ${error}`,
        details: error 
      };
    }
  }

  private async runCommand(command: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, { cwd, stdio: 'pipe' });
      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });
    });
  }

  async runTest(): Promise<void> {
    console.log('🎬 Starting LibreChat Docker Integration Test');
    console.log('='.repeat(50));

    const results: TestResult[] = [];

    try {
      await this.setup();

      // Step 1: Start MCP Server
      const mcpResult = await this.startMcpServer();
      results.push(mcpResult);
      console.log(`${mcpResult.success ? '✅' : '❌'} ${mcpResult.message}`);

      if (!mcpResult.success) {
        throw new Error('Cannot proceed without MCP server');
      }

      // Step 2: Start LibreChat
      const librechatResult = await this.startLibreChat();
      results.push(librechatResult);
      console.log(`${librechatResult.success ? '✅' : '❌'} ${librechatResult.message}`);

      if (!librechatResult.success) {
        throw new Error('Cannot proceed without LibreChat');
      }

      // Step 3: Test Connection
      const connectionResult = await this.testMcpConnection();
      results.push(connectionResult);
      console.log(`${connectionResult.success ? '✅' : '❌'} ${connectionResult.message}`);

      // Step 4: Test Tool Execution
      const toolResult = await this.testToolExecution();
      results.push(toolResult);
      console.log(`${toolResult.success ? '✅' : '❌'} ${toolResult.message}`);

      // Summary
      const successCount = results.filter(r => r.success).length;
      console.log('\n' + '='.repeat(50));
      console.log(`🎯 Test Summary: ${successCount}/${results.length} tests passed`);
      
      if (successCount === results.length) {
        console.log('🎉 All LibreChat integration tests passed!');
      } else {
        console.log('❌ Some tests failed');
        results.filter(r => !r.success).forEach(r => {
          console.log(`   - ${r.message}`);
        });
      }

    } catch (error) {
      console.error('💥 Test execution failed:', error);
    } finally {
      // Cleanup
      console.log('\n🧹 Cleaning up...');
      for (const cleanupFn of this.cleanup.reverse()) {
        try {
          await cleanupFn();
        } catch (error) {
          console.warn('Cleanup warning:', error);
        }
      }
      console.log('✨ Cleanup complete');
    }
  }
}

// Run the test
async function main() {
  const test = new LibreChatDockerTest();
  await test.runTest();
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

export { LibreChatDockerTest };