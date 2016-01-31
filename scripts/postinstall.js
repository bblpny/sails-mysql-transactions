//
// attempts to match the .sh post install
//
var fs = require('fs');
var spawn = require('child_process').spawn;

var INFO="sails-mysql-transactions: ";// for console logs
var MOD_DIR="../../node_modules";

function pli(lines,wrap){// pretty lines
  var copy = Array.isArray(lines)?lines.slice():[lines||undefined], i;
  for(i=copy.length-1;i>=0;i--){copy[i]=INFO+copy[i];}
  if(wrap===true){copy.unshift('\033[1;31m');copy.push('\033[0m\n');}
  return copy;
}
function ctf(res,cbT,cbF){// call true false
  if(!res&&typeof cbF==='function'){
    return cbF(false);
  }else{
    return cbT((res&&true)||false);
  }
}
function efi(path,cbT,cbF){//exists file
  function _ws(err,stat){return ctf((!err)&&stat&&stat.isFile&&stat.isFile(),cbT,cbF);}
  try{return fs.stat(path,_ws);}catch(e){return ftc(false,cbT,cbF);}
}
function edi(path,cbT,cbF){//exists dir
  function _ws(err,stat){return ctf((!err)&&stat&&stat.isDirectory&&stat.isDirectory(),cbT,cbF);}
  try{return fs.stat(path,_ws);}catch(e){return ftc(false,cbT,cbF);}
}
function test_git(cbT,cbF){
  return efi('.gitmodules',function(){// true callback..

    // if gitmodules exists normally we would error to cbT.
    // but i'm loading the fork is from a tarball, where it does exist.
    // so, am check if if the package loading this is directing to the tarball.
    return fs.readFile('../../package.json','utf8',function(err,str){
      if(!err && str){
        // get the package.json as json.
        try{
          str=JSON.parse(str);
        }catch(e){
          // if couldn't read the json..
          str = null;
        }
        if(str){
          // check if its a tarball.
          str = str.dependencies;
          str = str && str['sails-mysql-transactions'];
          if(str && str.length){
            str=str.toLowerCase();
            if(str &&
              str.indexOf('//github.com/')!==-1 &&
              str.indexOf('/tarball/') !== -1){
                // loaded from tarball, treat as if its not github.
                return ctf(false,cbT,cbF);
            }
          }
        }
      }
      // otherwise, yes, github.
      return ctf(true,cbT,cbF);
    });
  },cbF);//<-- for case where no .gitmodules exist.
}
function cli(image,args,workingdir,cb){// call image
  var proc,result_error=null,result_code=null;
  function procdone(err,code){
    var cbc=cb;cb=null;
    result_error=result_error||err;
    result_code=(code === 0 || code) ? (result_code||code) : result_code;
    if(!cbc)return;
    if(result_error){ console.log(result_error,result_error.stack||''); return done(null,result_code||1); }
    if(result_code !== 0){ return done([image+' exited with code:'+result_code],result_code||1); }
    return cbc();
  } try {
    proc = spawn(image,args||[],{cwd:workingdir||undefined,env:process.env});
    proc.on('error', function(err){ return procdone(err); });
    proc.stdout.on('data', function(data){process.stdout.write(data);});
    proc.stderr.on('data', function(data){process.stderr.write(data);});
    proc.on('exit', function(code){ return procdone(null,code); });
  }catch(e){ return procdone(e); }
}
// callbacks, done exits the program with ([message-lines], exitcode)
// warn and note simply log and do not take exit code.
// if message-lines is not an array INFO is prefixed to the string value of it.
// (unless null or undefined, where then no message is shown)
var done,warn,note;

//# If this is an NPM installation, we do not expect `.gitmodules` in the directory
//# since it is ignored by `.npmignore`. This is a fairly robust check to test whether
//# this script has been run as part of npm install or as part of self install.
function error_not_npm(){return done('Not an NPM install, exiting waterline injection.',0);}

//# Check whether sails has been already installed or not. If not, this is an
//# error and we should not proceed.
function error_no_sails(){return done(pli(['Sails installation not found!','Ensure your package.json, which has sails-mysql-transaction, also includes sails.'],true),1)}

function error_sails_mysql(){return done(pli(['Sails installation not found!','Ensure your package.json, which has sails-mysql-transaction, also includes sails.'],true),1)}

function main(){
  return test_git(error_not_npm, function(){
  return edi(MOD_DIR+'/sails', function(){
  return edi(MOD_DIR+'/sails-mysql', function(mysql_exists){
    if(mysql_exists&&warn){warn(pli(['WARNING - detected sails-mysql.',
'You may face unexpected behaviour.',
'Preferably remove sails-mysql from packages before using this in production.'])
    );}
    if(note)note('Injecting waterline...');
    return cli('npm',['remove','waterline'],MOD_DIR+'/sails', function(){
    return cli('npm',['install',MOD_DIR+'/sails-mysql-transactions/waterline'], MOD_DIR+'/sails', function(){
      return done('Installation successful.',0);
    });// npm install
    });// npm remove
  });// /sails-mysql
  },error_no_sails);// /sails
  });// .gitmodules
}

function prt(message_lines){
  if(!(message_lines === null || typeof message_lines === 'undefined')){
    if(Array.isArray(message_lines)){
      message_lines.forEach(function(x){console.log(x);});
    }else{
      console.log(INFO+message_lines.toString());
    }
  }
}
warn=function(message_lines){prt(message_lines);}
note=function(message_lines){prt(message_lines);}
done=function(message_lines, code){
  prt(message_lines);
  return (code||code===0)?process.exit(code):process.abort();
}
main();
