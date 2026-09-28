import {syncSheets} from '../lib/sheets-sync.js';
try{console.log(await syncSheets());process.exit(0);}catch(e){console.error(e.message);process.exit(1);}
