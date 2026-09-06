import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests',testMatch:'**/*.spec.ts',workers:1,use:{baseURL:process.env.TEST_URL||'http://127.0.0.1:4173',headless:true,channel:'chrome',viewport:{width:1440,height:1100}},reporter:'list'});
