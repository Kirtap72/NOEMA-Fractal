import {enhanceNumberInput} from './fineControl';
import {defaultPrimitive,MAX_PRIMITIVES,defaultMaterial,readPrimitives,placePrimitive,transformPrimitive,groundPrimitive} from '../engine';
import type {Scene,ScenePrimitive,PrimitiveType,SceneHit} from '../engine';
import {MaterialPanel} from './materialPanel';
/** A flat, small object editor; stable IDs are independent of array order. */
export class PrimitivePanel {
 private scene:Scene|null=null;
 private selected='';
 private list:HTMLSelectElement;
 private enabled:HTMLInputElement;
 private assignment:HTMLSelectElement;
 private fields=new Map<string,HTMLInputElement>();
 private material:MaterialPanel;
 private controls:HTMLElement;
 private undo:HTMLButtonElement;
 private materialRoot:HTMLElement;
 private grounded:HTMLInputElement;
 private placementNote:HTMLElement;
 placementRequest:{type:PrimitiveType;id?:string}|null=null;
 constructor(private root:HTMLElement,private change:(edit:(s:Scene)=>Scene)=>void,private restore:()=>void,private canUndo:()=>boolean,private workflow?:{placementChanged:()=>void;focus:(p:ScenePrimitive,frame:boolean)=>void}){
  const title=document.createElement('h3');title.textContent='Scene objects';root.append(title);
  const actions=document.createElement('div');actions.className='clip-actions';root.append(actions);
  const button=(name:string,action:()=>void,parent:HTMLElement=actions)=>{const b=document.createElement('button');b.textContent=name;b.type='button';b.addEventListener('click',action);parent.append(b);return b;};
  for(const type of ['sphere','box','plane'] as PrimitiveType[])button(`Add ${({sphere:'sphere',box:'box',plane:'plane'} as Record<string,string>)[type]}`,()=>{if(!this.scene||(this.scene.primitives?.length??0)>=MAX_PRIMITIVES)return;if(this.workflow){this.placementRequest={type};this.setPlacementNote('Click a visible surface. Esc cancels.');this.workflow.placementChanged();return;}const p=defaultPrimitive(type,crypto.randomUUID());p.position=[...this.scene.camera.target];this.selected=p.id;this.change(s=>({...s,primitives:[...(s.primitives??[]),p]}));});
  this.placementNote=document.createElement('div');this.placementNote.className='ainfo';this.placementNote.setAttribute('role','status');root.append(this.placementNote);
  if(this.workflow)button('Cancel placement',()=>this.cancelPlacement());
  this.list=document.createElement('select');this.list.setAttribute('aria-label','Chosen scene object');this.list.addEventListener('change',()=>{this.selected=this.list.value;if(this.scene)this.update(this.scene);});root.append(this.list);
  this.controls=document.createElement('div');this.controls.className='object-controls';root.append(this.controls);
  this.enabled=this.input('Object activated','checkbox',()=>this.edit(p=>({...p,enabled:this.enabled.checked})));
  this.grounded=this.input('Keep grounded','checkbox',()=>this.edit(p=>p.placement?groundPrimitive({...p,placement:{...p.placement,keepGrounded:this.grounded.checked}}):p));
  if(this.workflow){
   button('Place the chosen object here',()=>{const p=this.current();if(!p)return;this.placementRequest={type:p.type,id:p.id};this.setPlacementNote('Click the target surface. The chosen object is excluded. Esc cancels.');this.workflow!.placementChanged();},this.controls);
   button('Focus the chosen object',()=>{const p=this.current();if(p)this.workflow!.focus(p,false);},this.controls);
   button('Frame the chosen object',()=>{const p=this.current();if(p)this.workflow!.focus(p,true);},this.controls);
  }
  button('Duplicate object',()=>{const p=this.current();if(!p||!this.scene||this.scene.primitives!.length>=MAX_PRIMITIVES)return;const copy=structuredClone(p);copy.id=crypto.randomUUID();this.selected=copy.id;this.change(s=>({...s,primitives:[...(s.primitives??[]),copy]}));},this.controls);
  button('Delete object',()=>{const id=this.selected;this.change(s=>({...s,primitives:s.primitives?.filter(p=>p.id!==id)}));},this.controls);
  for(const [key,label] of [['position','Position'],['rotation','Rotation °'],['scale','Scale'],['color','Base colour (linear)']] as const){
   for(let i=0;i<3;i++){const name=`${label} ${(key==='color'?'RGB':'XYZ')[i]}`;const input=this.input(name,'number',()=>{if(!input.checkValidity())return;this.edit(p=>{const v=[...p[key]] as [number,number,number];v[i]=Number(input.value);return key==='color'?{...p,color:v}:transformPrimitive(p,{[key]:v});});});input.step='any';input.min=key==='scale'?'.0001':key==='color'?'0':'-1000000';input.max=key==='color'?'1':'1000000';this.fields.set(`${key}.${i}`,input);}
  }
  const row=document.createElement('label');row.className='arow';row.textContent='Material';this.assignment=document.createElement('select');this.assignment.setAttribute('aria-label','Object material');for(const [value,text] of [['scene','Scene material'],['custom','Own material']]){const o=document.createElement('option');o.value=value!;o.textContent=text!;this.assignment.append(o);}row.append(this.assignment);this.controls.append(row);
  this.assignment.addEventListener('change',()=>this.edit(p=>({...p,material:this.assignment.value==='scene'?'scene':structuredClone(this.scene!.material)})));
  this.materialRoot=document.createElement('div');this.controls.append(this.materialRoot);this.material=new MaterialPanel(this.materialRoot,{onChange:(name,value)=>this.edit(p=>({...p,material:{...(p.material==='scene'?this.scene!.material:p.material),[name]:value}})),onPreset:material=>this.edit(p=>({...p,material}))});
  this.undo=button('Undo scene change',()=>this.restore(),root);
  const note=document.createElement('div');note.className='ainfo';note.textContent='Sphere: local radius 1. Box: half side length 1. Plane: infinite, local Y normal. Rotation XYZ in degrees. At most 32 objects. Mesh/SDF export covers the fractal.';root.append(note);
 }
 setPlacementNote(message:string){this.placementNote.textContent=message;}
 cancelPlacement(){this.placementRequest=null;this.setPlacementNote('Placement cancelled.');this.workflow?.placementChanged();}
 placeAt(hit:SceneHit){
  const request=this.placementRequest;if(!request||!this.scene)return;
  let p=request.id?this.scene.primitives?.find(p=>p.id===request.id):defaultPrimitive(request.type,crypto.randomUUID());if(!p)return;
  if(!request.id){const r=Math.max(.0001,Math.hypot(...this.scene.camera.position.map((v,i)=>v-this.scene!.camera.target[i]!))*.04);p={...p,scale:[r,r,r]};}
  const placed=placePrimitive(p,hit);this.selected=placed.id;this.placementRequest=null;
  this.change(s=>({...s,primitives:request.id?s.primitives!.map(p=>p.id===request.id?placed:p):[...(s.primitives??[]),placed]}));
  this.setPlacementNote(`Placed on ${hit.objectId}. Keep grounded preserves contact when scaling.`);this.workflow?.placementChanged();
 }
 private input(label:string,type:string,change:()=>void){const row=document.createElement('label');row.className='arow';row.textContent=label;const input=document.createElement('input');input.type=type;input.setAttribute('aria-label',label);input.addEventListener('change',change);row.append(input);if(type==='number'){input.step='any';enhanceNumberInput(input,{commit:'change'});}this.controls.append(row);return input;}
 private current(){return this.scene?.primitives?.find(p=>p.id===this.selected);}
 private edit(update:(p:ScenePrimitive)=>ScenePrimitive){const id=this.selected;if(!this.current())return;this.change(s=>{const primitives=s.primitives!.map(p=>p.id===id?update(p):p),errors:string[]=[];readPrimitives(primitives,errors);return errors.length?s:{...s,primitives};});}
 update(scene:Scene){
  this.scene=scene;const objects=scene.primitives??[];if(!objects.some(p=>p.id===this.selected))this.selected=objects[0]?.id??'';
  // Rebuild only when the list changes, keeping keyboard focus and numeric edits intact.
  const signature=objects.map(p=>`${p.id}:${p.type}:${p.enabled}`).join('|');if(this.list.dataset.signature!==signature){this.list.replaceChildren();for(const [i,p] of objects.entries()){const o=document.createElement('option');o.value=p.id;o.textContent=`${i+1}. ${p.type}${p.enabled?'':' (av)'}`;this.list.append(o);}this.list.dataset.signature=signature;}
  this.list.value=this.selected;this.undo.disabled=!this.canUndo();const p=this.current();this.controls.hidden=!p;if(!p)return;
  this.enabled.checked=p.enabled;this.grounded.disabled=!p.placement;this.grounded.checked=p.placement?.keepGrounded??false;this.assignment.value=p.material==='scene'?'scene':'custom';this.materialRoot.hidden=p.material==='scene';this.material.update(p.material==='scene'?defaultMaterial():p.material,p.type);
  for(const [key,input] of this.fields){const [property,index]=key.split('.');if(document.activeElement!==input)input.value=String(p[property as 'position'|'rotation'|'scale'|'color'][Number(index)]);}
 }
}
