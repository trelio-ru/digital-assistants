import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';

/** Serve ONE disposable bare Git repository through the native smart HTTP
 * protocol. A local marketplace directory cannot exercise source --ref pinning,
 * remove/add, or the enabled-plugin state retained across that transition.
 *
 * This is test transport only: loopback, no credentials/config inheritance,
 * no receive-pack/push, no arbitrary repository or executable selection. Every
 * backend child has bounded pipes/lifetime and is joined before root cleanup.
 */
export async function serveNativeGitFixture({root,environment}) {
  const children=new Map();
  const server=http.createServer((request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1');
    const read=url.pathname==='/repository.git/info/refs'&&request.method==='GET'
      &&url.search==='?service=git-upload-pack';
    const upload=url.pathname==='/repository.git/git-upload-pack'&&request.method==='POST'
      &&url.search==='';
    if(!read&&!upload){response.writeHead(403);response.end();return;}
    const input=[];let inputBytes=0;
    request.on('data',bytes=>{
      inputBytes+=bytes.length;
      if(inputBytes>1024*1024)request.destroy();else input.push(bytes);
    });
    request.on('error',()=>response.destroy());
    request.on('end',()=>{
      const child=spawn('git',['http-backend'],{cwd:root,shell:false,windowsHide:true,
        env:{...environment,GIT_PROJECT_ROOT:root,GIT_HTTP_EXPORT_ALL:'1',PATH_INFO:url.pathname,
          QUERY_STRING:url.search.slice(1),REQUEST_METHOD:request.method,
          CONTENT_TYPE:request.headers['content-type']??'',CONTENT_LENGTH:String(inputBytes)},
        stdio:['pipe','pipe','ignore']});
      const closed=new Promise(resolve=>child.once('close',resolve));children.set(child,closed);
      const timer=setTimeout(()=>child.kill(),10_000);timer.unref();
      const chunks=[];let outputBytes=0;
      child.stdout.on('data',bytes=>{
        outputBytes+=bytes.length;
        if(outputBytes>2*1024*1024)child.kill();else chunks.push(bytes);
      });
      child.stdin.on('error',()=>{});
      child.on('error',()=>{if(!response.writableEnded){response.writeHead(500);response.end();}});
      child.once('close',code=>{
        clearTimeout(timer);children.delete(child);
        if(response.writableEnded)return;
        const bytes=Buffer.concat(chunks),separator=bytes.indexOf('\r\n\r\n');
        if(code!==0||separator<0||separator>8192||outputBytes>2*1024*1024){response.writeHead(500);response.end();return;}
        const headers={};let status=200;
        for(const line of bytes.subarray(0,separator).toString('utf8').split('\r\n')){
          const colon=line.indexOf(':');if(colon<0)continue;
          const name=line.slice(0,colon).toLowerCase(),value=line.slice(colon+1).trim();
          if(name==='status')status=Number(value.split(' ')[0]);
          else if(['content-type','cache-control','expires','pragma'].includes(name))headers[name]=value;
        }
        response.writeHead(status,headers);response.end(bytes.subarray(separator+4));
      });
      child.stdin.end(Buffer.concat(input));
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();assert.ok(address&&typeof address==='object');
  return {url:`http://127.0.0.1:${address.port}/repository.git`,async close(){
    const closing=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    server.closeAllConnections();
    const pending=[...children];for(const [child]of pending)child.kill();
    await Promise.all(pending.map(([,closed])=>closed));await closing;
  }};
}
