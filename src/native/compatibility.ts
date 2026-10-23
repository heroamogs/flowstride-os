import fs from 'node:fs';
import { Lexer, TokenType } from '../parser/lexer';
import { discoverFlows } from '../utils/projectPaths';
import type { FlowstrideConfig } from '../types';

/** Old Cloud engines remain usable for their existing commands. */
export function needsNativeBrowserProtocol(target: string, config: FlowstrideConfig): boolean {
  if (config.browser && config.browser !== 'chromium' || Object.keys(config.browserOptions || {}).length ||
      config.retries || config.failOnFlaky || config.trace || config.har || config.domSnapshots || config.shard) return true;
  return discoverFlows(target, config.projectRoot || process.cwd()).some(file =>
    new Lexer(fs.readFileSync(file,'utf8')).tokenise().some(token =>
      token.type === TokenType.ALIAS_COMMAND && /^flow\.(browser|assert|network|download|clock|stub|trace|har|a11y|component)\./i.test(token.value)));
}
