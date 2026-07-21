import {spawn} from 'node:child_process';

// npm.cmd cannot be spawned directly on newer Node.js versions on Windows
// (it fails with EINVAL). When this script is launched through `npm run`, npm
// exposes the path to its JavaScript CLI, which we can run with Node directly.
const npmCli = process.env.npm_execpath;
const npmCommand = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const npmArgs = script => npmCli ? [npmCli, 'run', '--silent', script] : ['run', '--silent', script];

const color=process.stdout.isTTY&&!process.env.NO_COLOR;
const paint=(code,value)=>color?`\x1b[${code}m${value}\x1b[0m`:value;
const logo=[
  '███████╗██╗██╗     ███████╗██████╗ ██╗██╗      ██████╗ ████████╗',
  '██╔════╝██║██║     ██╔════╝██╔══██╗██║██║     ██╔═══██╗╚══██╔══╝',
  '█████╗  ██║██║     █████╗  ██████╔╝██║██║     ██║   ██║   ██║   ',
  '██╔══╝  ██║██║     ██╔══╝  ██╔═══╝ ██║██║     ██║   ██║   ██║   ',
  '██║     ██║███████╗███████╗██║     ██║███████╗╚██████╔╝   ██║   ',
  '╚═╝     ╚═╝╚══════╝╚══════╝╚═╝     ╚═╝╚══════╝ ╚═════╝    ╚═╝   '
];
const shades=['38;2;96;165;250','38;2;75;145;246','38;2;59;130;246','38;2;72;111;238','38;2;99;102;241','38;2;139;92;246'];
console.log('');
logo.forEach((line,index)=>console.log(`  ${paint(shades[index],line)}`));
console.log(`\n  ${paint('1;97','FILEPILOT')} ${paint('38;2;147;197;253','v1.1.0')}  ${paint('38;2;71;85;105','•')}  ${paint('38;2;203;213;225','Development Console')}`);
console.log(`  ${paint('38;2;34;211;238','Dateien. Klar auf Kurs.')}`);
console.log(`  ${paint('38;2;71;85;105','──────────────────────────────────────────────────────────────────')}`);
console.log(`  ${paint('38;2;148;163;184','Frontend und API werden gestartet …')}\n`);

const children = [
  spawn(npmCommand, npmArgs('dev:frontend'), {stdio: 'inherit'}),
  spawn(npmCommand, npmArgs('dev:server'), {stdio: 'inherit',env:{...process.env,FILEPILOT_DEV_ORCHESTRATOR:'1'}})
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.killed||!child.pid)continue;
    if(process.platform==='win32'){
      spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
    }else child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), process.platform==='win32'?1200:250);
}

for (const child of children) {
  child.on('exit', code => {
    if (!stopping) stop(code ?? 0);
  });
  child.on('error', error => {
    console.error(error);
    stop(1);
  });
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
