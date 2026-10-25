const http=require('node:http');const fs=require('node:fs');const path=require('node:path');const {chromium}=require('playwright');
exports.run=async suite=>{
 const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{const target=path.join(root,req.url==='/'?'index.html':decodeURIComponent(req.url.split('?')[0]));if(!target.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(target,(e,data)=>{if(e){res.writeHead(404).end();return;}res.setHeader('Content-Type',(target.endsWith('.js')||target.endsWith('.mjs'))?'text/javascript':target.endsWith('.css')?'text/css':'text/html');res.end(data);});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});let count=0;await suite({browser,url:`http://127.0.0.1:${server.address().port}`,check:label=>{count++;console.log('PASS '+label);}});console.log(`완료: ${count}개 검증 통과`);}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
};
exports.start=async page=>{await page.locator('#start-button').click();await page.locator('#lesson-view').waitFor({state:'visible'});};
