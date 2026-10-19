/** Browser-side integration. Import from flowstride/dist/game/three-bridge.
 * The application supplies its own Three.js constructors; no second Three.js
 * runtime, scene reconstruction, renderer or animation loop is created. */
export interface ThreeGameBridgeOptions {
  scene: any; camera: any; canvas: HTMLCanvasElement;
  Vector3: new (...args: any[]) => any; Raycaster: new (...args: any[]) => any;
  objects?: Record<string, any>; readState?: () => unknown;
  testMode?: boolean; fixtures?: Record<string, (data: unknown) => unknown>;
}
export function registerThreeGame(options: ThreeGameBridgeOptions) {
  if (!(options.canvas instanceof HTMLCanvasElement)) throw new Error('A live game canvas is required.');
  const objects = new Map(Object.entries(options.objects || {}));
  const locate = (id: string) => {
    let object=objects.get(id);
    if (!object) options.scene.traverse((candidate: any)=> { if(candidate.userData?.flowstrideId === id) { if(object) throw new Error(`Duplicate game object ID: ${id}`); object=candidate; } });
    if (!object) throw new Error(`Game object not found: ${id}`);
    let cursor=object;
    while(cursor) { if(cursor.visible === false) throw new Error(`Game object is hidden: ${id}`); cursor=cursor.parent; }
    options.scene.updateMatrixWorld(true); options.camera.updateMatrixWorld(true); options.camera.updateProjectionMatrix();
    const local=object.userData?.flowstridePickPoint;
    const point=local ? object.localToWorld(new options.Vector3(...local)) : object.getWorldPosition(new options.Vector3());
    point.project(options.camera);
    if (![point.x,point.y,point.z].every(Number.isFinite) || Math.abs(point.x)>1 || Math.abs(point.y)>1 || Math.abs(point.z)>1) throw new Error(`Game object is outside the camera: ${id}`);
    const ray = new options.Raycaster(); ray.layers.mask = options.camera.layers.mask; ray.setFromCamera({x:point.x,y:point.y},options.camera);
    const hits=ray.intersectObjects(options.scene.children,true);
    const front=hits.find((hit:any)=> { let node=hit.object; while(node) { if(node.visible===false) return false; node=node.parent; } return true; });
    cursor=front?.object;
    while(cursor && cursor !== object) cursor=cursor.parent;
    if (!cursor) throw new Error(`Game object is occluded or not pickable: ${id}`);
    const rect=options.canvas.getBoundingClientRect();
    const x=rect.left+(point.x+1)*rect.width/2, y=rect.top+(1-point.y)*rect.height/2;
    if (!rect.width || !rect.height || x<0 || y<0 || x>=innerWidth || y>=innerHeight || document.elementFromPoint(x,y)!==options.canvas) throw new Error(`Game object is covered or outside the viewport: ${id}`);
    return {x,y};
  };
  const bridge={ locate, readState:options.readState, testMode:options.testMode===true,
    fixtures: options.testMode===true ? options.fixtures || {} : {} };
  (window as any).__FLOWSTRIDE_GAME__=bridge;
  return { registerObject(id:string, object:any) { if(!id || objects.has(id)) throw new Error('Game object ID must be unique and nonempty.'); objects.set(id,object); },
    dispose() { if((window as any).__FLOWSTRIDE_GAME__===bridge) delete (window as any).__FLOWSTRIDE_GAME__; } };
}
