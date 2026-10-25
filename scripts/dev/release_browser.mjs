// One explicit engine choice for all protected layout/interaction runners.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(path.join(root,'frontend/package.json'));
const playwright=require('playwright');
export const browserEngine=process.env.RELEASE_BROWSER_ENGINE||'chromium';
if(!['chromium','firefox','webkit'].includes(browserEngine))throw new Error('Unsupported RELEASE_BROWSER_ENGINE: '+browserEngine);
export const releaseOutputRoot=(repoRoot=root)=>path.join(repoRoot,'outputs/agent/release-regressions',...(browserEngine==='chromium'?[]:[browserEngine]));
export async function launchReleaseBrowser({quiet=false}={}){
 const options={headless:true};
 if(browserEngine==='chromium'){
  options.channel=process.env.RELEASE_BROWSER_CHANNEL||process.env.PLAYWRIGHT_CHANNEL||(process.platform==='win32'?'msedge':'chromium');
  options.args=['--no-proxy-server'];
 }
 const browser=await playwright[browserEngine].launch(options);
 const folder=releaseOutputRoot();await fs.mkdir(folder,{recursive:true});
 await fs.writeFile(path.join(folder,'engine.json'),JSON.stringify({engine:browserEngine,version:browser.version(),platform:process.platform,actualSafari:false},null,2));
 if(!quiet)console.log('[browser]',browserEngine,browser.version());
 return browser;
}
