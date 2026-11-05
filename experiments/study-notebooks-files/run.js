// usage: node run.js <file> <model> <label> [prompt-file]
const {execFile}=require('child_process'),fs=require('fs'),os=require('os'),path=require('path');
const [file,model,label,pf]=process.argv.slice(2);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nb-'));fs.copyFileSync(file,path.join(dir,'doc'+path.extname(file)));
const prompt=fs.readFileSync(pf||'prompt.txt','utf8').replace('DOC','doc'+path.extname(file));
const t=Date.now();
execFile('C:/Users/User/AppData/Local/agy/bin/agy.exe',['-p',prompt,'--model',model],{cwd:dir,maxBuffer:5e7,timeout:600000},(e,so,se)=>{
 const s=((Date.now()-t)/1000).toFixed(1);fs.writeFileSync(label+'.out.txt',so);fs.writeFileSync(label+'.meta.txt',`seconds=${s} err=${e?e.message.slice(0,300):'none'} stderr=${se.slice(0,300)} chars=${so.length}`);fs.rmSync(dir,{recursive:true,force:true});});
