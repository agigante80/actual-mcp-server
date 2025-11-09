/**
 * Simplified integration test: Test MCP server HTTP interface that LibreChat would use
 * This test verifies the HTTP endpoints without requiring Docker LibreChat
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestResult {
  success: boolean;
  message: string;
  details?: any;
}

class McpHttpTest {
  private mcpServerProcess?: ChildProcess;
  private serverUrl = 'http://localhost:3600'; // Will be updated with random port
  private sessionId?: string;
  private cookies: string[] = []; // Store cookies from responses

  async startMcpServer(): Promise<TestResult> {
    console.log('🚀 Starting MCP server with HTTP interface...');
    
    try {
      // Start MCP server with HTTP endpoint on a random available port
      const testPort = 3600 + Math.floor(Math.random() * 100);
      this.serverUrl = `http://localhost:${testPort}`;
      
      console.log(`Using port ${testPort} for MCP server`);
      
      this.mcpServerProcess = spawn('npm', ['--silent', 'run', 'start', '--', '--http', '--debug'], {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { 
          ...process.env,
          MCP_BRIDGE_PORT: testPort.toString()
        }
      });

      let output = '';
      let errorOutput = '';
      
      this.mcpServerProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        output += text;
        console.log('MCP Output:', text.trim());
      });

      this.mcpServerProcess.stderr?.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        console.log('MCP Error:', text.trim());
      });

      // Wait for server to start (look for HTTP server indicators)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('MCP server failed to start within 30 seconds'));
        }, 30000);

        const checkOutput = () => {
          if (output.includes('HTTP server') || output.includes('listening') || output.includes('Server started')) {
            clearTimeout(timeout);
            resolve(void 0);
          }
        };

        this.mcpServerProcess!.stdout?.on('data', checkOutput);
        
        // Also check if process exits early
        this.mcpServerProcess!.on('exit', (code) => {
          if (code !== 0) {
            clearTimeout(timeout);
            reject(new Error(`MCP server exited with code ${code}. Error output: ${errorOutput}`));
          }
        });
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

  async testHealthEndpoint(): Promise<TestResult> {
    console.log('🏥 Testing health endpoint...');
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(`${this.serverUrl}/health`, {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Health endpoint returned ${response.status}: ${response.statusText}`);
      }

      const health = await response.json();
      console.log('📊 Health response:', health);

      return { 
        success: true, 
        message: 'Health endpoint test passed',
        details: health
      };
    } catch (error) {
      return { 
        success: false, 
        message: `Health endpoint test failed: ${error}`,
        details: error 
      };
    }
  }

  async testToolsEndpoint(): Promise<TestResult> {
    console.log('🛠️  Testing tools listing endpoint...');
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      // Include cookies if we have them
      if (this.cookies.length > 0) {
        headers['Cookie'] = this.cookies.join('; ');
      }

      const response = await fetch(`${this.serverUrl}/http`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {}
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Tools endpoint returned ${response.status}: ${response.statusText}`);
      }

      const result = await response.json() as any;
      console.log(`📋 MCP Tools response:`, JSON.stringify(result, null, 2));
      
      const tools = result.result?.tools || [];
      console.log(`�️  Found ${tools.length} tools available`);
      
      // Log first few tool names
      if (tools.length > 0) {
        const toolNames = tools.slice(0, 5).map((t: any) => t.name || t.toolName || 'unknown').join(', ');
        console.log(`🎯 Sample tools: ${toolNames}${tools.length > 5 ? '...' : ''}`);
      }

      return { 
        success: true, 
        message: `Tools endpoint test passed (${tools.length} tools)`,
        details: { toolCount: tools.length, tools: tools.slice(0, 3) }
      };
    } catch (error) {
      return { 
        success: false, 
        message: `Tools endpoint test failed: ${error}`,
        details: error 
      };
    }
  }

  async testToolExecution(): Promise<TestResult> {
    console.log('🧪 Testing tool execution...');
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      // Include cookies if we have them
      if (this.cookies.length > 0) {
        headers['Cookie'] = this.cookies.join('; ');
      }

      const response = await fetch(`${this.serverUrl}/http`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'actual.accounts.list',
            arguments: {}
          }
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Tool execution returned ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      console.log('🎯 Tool execution result:', JSON.stringify(result, null, 2));

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

  async testMcpInitialize(): Promise<TestResult> {
    console.log('⚡ Testing MCP initialize (required for session)...');
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(`${this.serverUrl}/http`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'test-client',
              version: '1.0.0'
            }
          }
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Initialize returned ${response.status}: ${response.statusText}`);
      }

      // Store cookies from the response
      const setCookieHeaders = response.headers.get('set-cookie');
      if (setCookieHeaders) {
        this.cookies.push(setCookieHeaders);
        console.log('📿 Stored session cookies:', setCookieHeaders);
      }

      const result = await response.json();
      console.log('⚡ Initialize response:', JSON.stringify(result, null, 2));

      // Extract session info if available
      if (result.result) {
        // Session is established, store it for later use
        this.sessionId = 'initialized'; // MCP sessions are implicit in HTTP mode
      }

      return { 
        success: true, 
        message: 'MCP initialize test passed',
        details: result
      };
    } catch (error) {
      return { 
        success: false, 
        message: `MCP initialize test failed: ${error}`,
        details: { error: error instanceof Error ? error.message : error }
      };
    }
  }

  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up MCP server...');
    if (this.mcpServerProcess) {
      this.mcpServerProcess.kill('SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          console.log('⚠️  Force killing MCP server...');
          this.mcpServerProcess?.kill('SIGKILL');
          resolve(void 0);
        }, 5000);
        
        this.mcpServerProcess?.on('exit', () => {
          clearTimeout(timeout);
          resolve(void 0);
        });
      });
    }
  }

  async runTest(): Promise<void> {
    console.log('🎬 Starting MCP HTTP Interface Test');
    console.log('='.repeat(50));

    const results: TestResult[] = [];

    try {
      // Step 1: Start MCP Server
      const serverResult = await this.startMcpServer();
      results.push(serverResult);
      console.log(`${serverResult.success ? '✅' : '❌'} ${serverResult.message}`);

      if (!serverResult.success) {
        throw new Error('Cannot proceed without MCP server');
      }

      // Give server a moment to fully initialize
      console.log('⏳ Waiting for server to fully initialize...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Step 2: Test Health Endpoint
      const healthResult = await this.testHealthEndpoint();
      results.push(healthResult);
      console.log(`${healthResult.success ? '✅' : '❌'} ${healthResult.message}`);

      // Step 3: Test MCP Initialize (required for session)
      const initializeResult = await this.testMcpInitialize();
      results.push(initializeResult);
      console.log(`${initializeResult.success ? '✅' : '❌'} ${initializeResult.message}`);

      if (!initializeResult.success) {
        throw new Error('Cannot proceed without MCP session');
      }

      // Step 4: Test Tools Endpoint (needs session)
      const toolsResult = await this.testToolsEndpoint();
      results.push(toolsResult);
      console.log(`${toolsResult.success ? '✅' : '❌'} ${toolsResult.message}`);

      // Step 5: Test Tool Execution (needs session)
      const executionResult = await this.testToolExecution();
      results.push(executionResult);
      console.log(`${executionResult.success ? '✅' : '❌'} ${executionResult.message}`);

      // Summary
      const successCount = results.filter(r => r.success).length;
      console.log('\n' + '='.repeat(50));
      console.log(`🎯 Test Summary: ${successCount}/${results.length} tests passed`);
      
      if (successCount === results.length) {
        console.log('🎉 All MCP HTTP interface tests passed!');
        console.log('✨ The MCP server is ready for LibreChat integration');
      } else {
        console.log('❌ Some tests failed:');
        results.filter(r => !r.success).forEach(r => {
          console.log(`   - ${r.message}`);
          if (r.details) {
            console.log(`     Details: ${JSON.stringify(r.details, null, 2)}`);
          }
        });
        throw new Error('One or more tests failed');
      }

    } catch (error) {
      console.error('💥 Test execution failed:', error);
      throw error;
    } finally {
      await this.cleanup();
      console.log('✨ Cleanup complete');
    }
  }
}

// Run the test
async function main() {
  const test = new McpHttpTest();
  await test.runTest();
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
}

export { McpHttpTest };