import type {Scene} from '../engine/scene';
import type {SceneSync} from './sceneSync';

/** One focused edit/drag is one existing undo transaction, not one transaction per input event. */
export class PanelUndo {
  private last?:Scene;
  constructor(private sync:Pick<SceneSync,'scene'|'edit'|'editWithUndo'>){}
  end():void { this.last=undefined; }
  edit(change:(scene:Scene)=>Scene):void {
    // Undo, Open, presets and edits elsewhere always break the gesture, even before blur arrives.
    if(this.last===this.sync.scene)this.sync.edit(change);
    else this.sync.editWithUndo(change);
    this.last=this.sync.scene;
  }
}

export function bindPanelUndo(root:HTMLElement,sync:SceneSync,shared?:PanelUndo):PanelUndo {
  const undo=shared??new PanelUndo(sync);
  root.addEventListener('pointerdown',()=>undo.end(),true);
  root.addEventListener('focusin',()=>undo.end());
  root.addEventListener('focusout',()=>undo.end());
  root.addEventListener('click',event=>{
    if((event.target as Element).closest('button'))undo.end();
  },true);
  return undo;
}
