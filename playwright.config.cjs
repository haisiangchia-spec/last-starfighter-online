const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
 testDir:'./tests/browser',timeout:90000,expect:{timeout:15000},retries:1,workers:1,
 reporter:[['list'],['html',{outputFolder:'playwright-report',open:'never'}]],
 use:{baseURL:'http://127.0.0.1:4173',browserName:'chromium',headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'npx http-server . -a 127.0.0.1 -p 4173 -c-1 --silent',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI,timeout:30000}
});
