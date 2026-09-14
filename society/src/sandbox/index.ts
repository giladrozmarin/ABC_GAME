import type { SocietyConfig } from '../config.js';
import type { SandboxProvider } from './provider.js';
import { ProcessSandboxProvider } from './process.js';
import { DockerSandboxProvider } from './docker.js';
import { DaytonaSandboxProvider } from './daytona.js';
import { E2BSandboxProvider } from './e2b.js';

export function createSandboxProvider(cfg: SocietyConfig): SandboxProvider {
  switch (cfg.sandboxProvider) {
    case 'process': return new ProcessSandboxProvider(cfg.dataDir);
    case 'docker': return new DockerSandboxProvider({ image: cfg.dockerImage, network: cfg.dockerNetwork, setupCommand: cfg.sandboxSetupCommand });
    case 'daytona':
      if (!cfg.daytonaApiKey) throw new Error('DAYTONA_API_KEY required');
      return new DaytonaSandboxProvider({ apiKey: cfg.daytonaApiKey, apiUrl: cfg.daytonaApiUrl, snapshot: cfg.daytonaSnapshot, image: cfg.daytonaImage, setupCommand: cfg.sandboxSetupCommand });
    case 'e2b':
      if (!cfg.e2bApiKey) throw new Error('E2B_API_KEY required');
      return new E2BSandboxProvider({ apiKey: cfg.e2bApiKey, template: cfg.e2bTemplate, setupCommand: cfg.sandboxSetupCommand });
  }
}
