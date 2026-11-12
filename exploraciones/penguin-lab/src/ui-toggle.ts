/** Botón «Ocultar interfaz» (y tecla H): deja solo el paisaje y el pingüino, con el botón visible para
 * volver. La preferencia se recuerda en este navegador si el almacenamiento está disponible. */
const STORAGE_KEY='antaris-pinguino-menu-ui-oculta';
export function setupUiToggle(button:HTMLButtonElement){
 const label=button.querySelector('span')??button;
 const apply=(hidden:boolean)=>{
  document.body.classList.toggle('ui-hidden',hidden);button.setAttribute('aria-pressed',String(hidden));
  label.textContent=hidden?'Mostrar interfaz':'Ocultar interfaz';
  try{localStorage.setItem(STORAGE_KEY,hidden?'1':'0');}catch{/* sin almacenamiento: solo esta visita */}
 };
 let initial=false;try{initial=localStorage.getItem(STORAGE_KEY)==='1';}catch{/* idem */}
 apply(initial);
 button.addEventListener('click',()=>apply(!document.body.classList.contains('ui-hidden')));
 const keydown=(event:KeyboardEvent)=>{
  if(event.code!=='KeyH'||event.repeat||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  apply(!document.body.classList.contains('ui-hidden'));
 };
 window.addEventListener('keydown',keydown);
 return ()=>window.removeEventListener('keydown',keydown);
}
