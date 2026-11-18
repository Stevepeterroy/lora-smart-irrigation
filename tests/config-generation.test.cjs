const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const source=fs.readFileSync(path.join(__dirname,'../scripts/generate-web-config.cjs'),'utf8');
function run(value){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lora-public-config-'));
 fs.mkdirSync(path.join(root,'scripts'));for(const d of ['lora irrigation app new','android lora irrigation  app new'])fs.mkdirSync(path.join(root,d));
 const script=path.join(root,'scripts/generate-web-config.cjs');fs.writeFileSync(script,source);
 const env={...process.env};delete env.FIREBASE_WEB_CONFIG;if(value!==undefined)env.FIREBASE_WEB_CONFIG=value;
 const result=spawnSync(process.execPath,[script],{env,encoding:'utf8'});
 const file=path.join(root,'lora irrigation app new/firebase-config.local.js');const output=fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;
 fs.rmSync(root,{recursive:true,force:true});return {result,output};
}
test('missing or invalid build configuration fails without exposing values',()=>{
 for(const value of [undefined,'not valid json','{}']){const {result,output}=run(value);assert.notEqual(result.status,0);assert.equal(output,null);}
});
test('only browser configuration fields are generated, never gateway or service keys',()=>{
 const value={apiKey:'example-key',projectId:'example',databaseURL:'https://example.invalid',appId:'example-app',private_key:'DO_NOT_PUBLISH',FIREBASE_LEGACY_TOKEN:'DO_NOT_PUBLISH',WIFI_PASSWORD:'DO_NOT_PUBLISH'};
 const {result,output}=run(JSON.stringify(value));assert.equal(result.status,0);assert.match(output,/example-key/);assert.doesNotMatch(output,/DO_NOT_PUBLISH/);
 assert.doesNotMatch(result.stdout,/example-key/);
});
