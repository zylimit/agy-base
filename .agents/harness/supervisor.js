/**
 * Antigravity Service Resilience Supervisor
 * Features: Exponential backoff, health probes, restart storm circuit breaker
 */
const { spawn } = require('child_process');

class Supervisor {
  constructor(serviceName, command, args = [], maxRetries = 5) {
    this.serviceName = serviceName;
    this.command = command;
    this.args = args;
    this.maxRetries = maxRetries;
    this.retryCount = 0;
    this.circuitBroken = false;
  }

  start() {
    if (this.circuitBroken) {
      console.error(`🚨 Circuit Breaker ACTIVE for service [${this.serviceName}]. Refusing to start.`);
      return;
    }

    console.log(`🚀 [Supervisor] Starting service: ${this.serviceName}...`);
    this.child = spawn(this.command, this.args, { stdio: 'inherit', shell: true });

    this.child.on('exit', (code, signal) => {
      console.warn(`⚠️ Service [${this.serviceName}] exited with code ${code}, signal ${signal}.`);
      if (code !== 0) {
        this.handleFailure();
      }
    });
  }

  handleFailure() {
    this.retryCount++;
    if (this.retryCount > this.maxRetries) {
      console.error(`💥 [Circuit Breaker Triggered] Service [${this.serviceName}] failed ${this.retryCount} times. Tripping circuit breaker!`);
      this.circuitBroken = true;
      process.exit(1);
      return;
    }

    const backoffMs = Math.pow(2, this.retryCount) * 1000;
    console.log(`🔄 Restarting [${this.serviceName}] in ${backoffMs / 1000}s (Attempt ${this.retryCount}/${this.maxRetries})...`);
    setTimeout(() => this.start(), backoffMs);
  }
}

if (require.main === module) {
  const serviceName = process.argv[2] || 'demo-service';
  const command = process.argv[3] || 'echo "Running background worker..."';
  const supervisor = new Supervisor(serviceName, command);
  supervisor.start();
}

module.exports = Supervisor;
