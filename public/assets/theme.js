(()=>{const root=document.documentElement,key='mip-theme',media=matchMedia('(prefers-color-scheme: dark)');
let saved=null;try{saved=localStorage.getItem(key);}catch{}if(saved==='dark'||saved==='light')root.dataset.theme=saved;
const dark=()=>root.dataset.theme?root.dataset.theme==='dark':media.matches;
const sync=()=>document.querySelectorAll('[data-theme-toggle]').forEach(b=>b.setAttribute('aria-pressed',String(dark())));
document.addEventListener('click',ev=>{if(!ev.target.closest('[data-theme-toggle]'))return;root.dataset.theme=dark()?'light':'dark';try{localStorage.setItem(key,root.dataset.theme);}catch{}sync();});
media.addEventListener('change',sync);})();
