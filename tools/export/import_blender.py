"""Reconstruct a v1 scene bundle in a NEW Blender scene, preserving existing scenes.
Blender 5.2 conventional import; Gaussian support detected through actual RNA.
Usage: blender --background --python import_blender.py -- scene.manifest.json
Optional: --save scene.blend --render image.png --usd scene.usda --glb scene.glb
No downloaded code, dependencies or automatic application installation.
"""
import argparse
import importlib.util
import json
import math
import sys
import struct
from pathlib import Path
import bpy
from mathutils import Matrix, Vector, Euler

C = Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))

def convert(v):
    return Vector((v[0],-v[2],v[1]))

def srgb_hex(value):
    values = [int(value[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in values)

def asset(root, relative):
    path = (root / relative).resolve()
    if Path(relative).is_absolute() or not path.is_relative_to(root):
        raise ValueError('Asset path escapes scene bundle: '+relative)
    if not path.is_file(): raise FileNotFoundError('Missing scene asset: '+relative)
    return path

def operator_available(operator):
    try: operator.get_rna_type(); return True
    except Exception: return False

def gaussian_available():
    return any(p.type=='ENUM' and any('gaussian' in e.identifier.lower() for e in p.enum_items)
               for p in bpy.types.PointCloud.bl_rna.properties)

def restore_point_attributes(obj,path):
    """PLY importers may ignore normals on vertices without faces. Retain them explicitly."""
    raw=path.read_bytes(); end=raw.index(b'end_header\n')+11
    header=raw[:end].decode('ascii'); fields=[]; count=0
    codes={'float':'f','uchar':'B','uint':'I'}
    for line in header.splitlines():
        tokens=line.split()
        if tokens[:2]==['element','vertex']: count=int(tokens[2])
        if tokens[:1]==['property']:
            if len(tokens)!=3 or tokens[1] not in codes: raise ValueError('Unsupported point PLY property')
            fields.append((tokens[2],codes[tokens[1]]))
    layout=struct.Struct('<'+''.join(code for name,code in fields))
    if len(raw)-end!=count*layout.size or len(obj.data.vertices)!=count: raise ValueError('Point PLY count differs')
    names=[name for name,code in fields]
    if all(name in names for name in ('nx','ny','nz')):
        indices=[names.index(name) for name in ('nx','ny','nz')]
        normals=[row[i] for row in layout.iter_unpack(raw[end:]) for i in indices]
        attribute=obj.data.attributes.new('surface_normal','FLOAT_VECTOR','POINT'); attribute.data.foreach_set('vector',normals)

def material(source, root, tint=(1,1,1), vertex=False, primitive=False):
    result=bpy.data.materials.new(source['id']); result.use_nodes=True
    result['fraktalmotorn_material_id']=source['id']
    result['fraktalmotorn_source']=json.dumps(source)
    nodes=result.node_tree.nodes; links=result.node_tree.links
    bsdf=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
    output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
    color=[a*b for a,b in zip(source['baseColor'],tint)]
    bsdf.inputs['Base Color'].default_value=(*color,1)
    for key,value in (('Metallic',source['metallic']),('Roughness',source['roughness']),
                      ('Specular IOR Level',source['reflectivity']*.5),
                      ('Transmission Weight',source['transmission']),('IOR',source['ior']),
                      ('Emission Strength',source['emissionStrength'])):
        bsdf.inputs[key].default_value=value
    bsdf.inputs['Emission Color'].default_value=(*source['emissionColor'],1)
    if vertex:
        attribute=nodes.new('ShaderNodeVertexColor'); attribute.layer_name='Color'
        multiply=nodes.new('ShaderNodeMixRGB'); multiply.blend_type='MULTIPLY'
        multiply.inputs[0].default_value=1; multiply.inputs[2].default_value=(*color,1)
        links.new(attribute.outputs['Color'],multiply.inputs[1]); links.new(multiply.outputs[0],bsdf.inputs['Base Color'])
    if source['transmission']>0 and source['absorptionDensity']>0:
        coefficients=[-math.log(max(v,1e-6))*source['absorptionDensity'] for v in source['absorptionColor']]
        density=max(coefficients)
        if density>0:
            absorption=nodes.new('ShaderNodeVolumeAbsorption')
            absorption.inputs['Density'].default_value=density
            absorption.inputs['Color'].default_value=(*(1-v/density for v in coefficients),1)
            links.new(absorption.outputs[0],output.inputs['Volume'])
    detail=source['source'].get('surfaceDetail',{})
    coordinate=nodes.new('ShaderNodeTexCoord'); mapping=nodes.new('ShaderNodeMapping')
    mapping.inputs['Scale'].default_value=(detail.get('scale',1),)*3
    mapping.inputs['Rotation'].default_value=(0,0,math.radians(detail.get('rotation',0)))
    offset=detail.get('offset',[0,0]); mapping.inputs['Location'].default_value=(offset[0],offset[1],0)
    links.new(coordinate.outputs['Generated'],mapping.inputs['Vector'])
    normal=None
    if detail.get('normal',{}).get('enabled') and source['images'].get('normal') and primitive:
        image=nodes.new('ShaderNodeTexImage'); image.image=bpy.data.images.load(str(asset(root,source['images']['normal'])),check_existing=True)
        image.image.colorspace_settings.name='Non-Color'
        node=nodes.new('ShaderNodeNormalMap'); node.inputs['Strength'].default_value=detail['normal']['strength']
        links.new(image.outputs['Color'],node.inputs['Color']); normal=node.outputs[0]
    if detail.get('bump',{}).get('enabled') and source['images'].get('bump'):
        image=nodes.new('ShaderNodeTexImage'); image.projection='BOX'; image.projection_blend=.2
        image.image=bpy.data.images.load(str(asset(root,source['images']['bump'])),check_existing=True); image.image.colorspace_settings.name='Non-Color'
        links.new(mapping.outputs[0],image.inputs['Vector'])
        bump=nodes.new('ShaderNodeBump'); bump.inputs['Distance'].default_value=detail['bump']['strength']*.05
        links.new(image.outputs['Color'],bump.inputs['Height'])
        if normal: links.new(normal,bump.inputs['Normal'])
        normal=bump.outputs[0]
    procedural=detail.get('procedural',{})
    if procedural.get('enabled'):
        noise=nodes.new('ShaderNodeTexVoronoi' if procedural['pattern']=='hammered' else 'ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value=procedural['scale']
        if 'Detail' in noise.inputs: noise.inputs['Detail'].default_value=procedural['octaves']
        if 'Roughness' in noise.inputs: noise.inputs['Roughness'].default_value=procedural['persistence']
        links.new(mapping.outputs[0],noise.inputs['Vector'])
        bump=nodes.new('ShaderNodeBump'); bump.inputs['Distance'].default_value=procedural['strength']*.05
        links.new(noise.outputs[0],bump.inputs['Height'])
        if normal: links.new(normal,bump.inputs['Normal'])
        normal=bump.outputs[0]
        if procedural['roughnessModulation']:
            scale=nodes.new('ShaderNodeMath'); scale.operation='MULTIPLY_ADD'
            scale.inputs[1].default_value=procedural['roughnessModulation']; scale.inputs[2].default_value=source['roughness']
            scale.use_clamp=True; links.new(noise.outputs[0],scale.inputs[0]); links.new(scale.outputs[0],bsdf.inputs['Roughness'])
    if normal: links.new(normal,bsdf.inputs['Normal'])
    return result

def reconstruct(manifest_path):
    manifest_path=Path(manifest_path).resolve(); root=manifest_path.parent
    data=json.loads(manifest_path.read_text(encoding='utf8'))
    if data.get('format')!='fraktalmotorn-scene-bundle' or data.get('version')!=1:
        raise ValueError('Unsupported scene bundle')
    # Resolve every referenced asset before changing the active scene.
    for file in data['files']:
        path=asset(root,file['path'])
        if path.stat().st_size!=file['bytes']: raise ValueError('Asset byte count differs: '+file['path'])
    asset(root,data['sourceScene']); asset(root,data['environment']['path'])
    for m in data['materials']:
        for path in m['images'].values(): asset(root,path)
    for r in data['representations']: asset(root,r['path'])
    ids=[r['id'] for r in data['representations']]+[p['id'] for p in data['primitives']]
    if len(ids)!=len(set(ids)): raise ValueError('Duplicate object identity')
    materials={m['id']:m for m in data['materials']}
    if len(materials)!=len(data['materials']): raise ValueError('Duplicate material identity')
    for entry in data['representations']+data['primitives']:
        if entry['materialId'] not in materials: raise ValueError('Unknown material identity')
    scene=bpy.data.scenes.new('Fraktalmotorn Scene'); bpy.context.window.scene=scene
    scene['fraktalmotorn_manifest']=json.dumps(data)
    scene['fraktalmotorn_source']=asset(root,data['sourceScene']).read_text(encoding='utf8')
    scene['fraktalmotorn_units']=data['units']
    scene.unit_settings.system='METRIC'; scene.unit_settings.scale_length=1
    scene.render.resolution_x=data['resolution']['width']; scene.render.resolution_y=data['resolution']['height']; scene.render.resolution_percentage=100
    report={'version':bpy.app.version_string,'sourceSceneVersion':data['sourceSceneVersion'],'objects':[],
            'diagnostics':data['diagnostics'],'unsupported':[],'volumeConversions':[]}
    for representation in data['representations']:
        path=asset(root,representation['path']); kind=representation['kind']; before=set(scene.objects)
        if kind=='volume':
            spec=importlib.util.spec_from_file_location('fraktalmotorn_vdb',Path(__file__).resolve().with_name('field_to_vdb.py'))
            module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
            vdb=path.with_suffix('.vdb'); report['volumeConversions'].append(module.convert_field(path,vdb))
            volume=bpy.data.volumes.new(representation['id']); volume.filepath=str(vdb)
            obj=bpy.data.objects.new(representation['id'],volume); scene.collection.objects.link(obj)
            meta=json.loads(path.read_text(encoding='utf8')); obj['fraktalmotorn_field']=json.dumps(meta)
            if meta['mode']=='surface-density':
                mat=bpy.data.materials.new('Field density'); mat.use_nodes=True; mat.node_tree.nodes.clear()
                shader=mat.node_tree.nodes.new('ShaderNodeVolumePrincipled'); shader.inputs['Density'].default_value=8
                output=mat.node_tree.nodes.new('ShaderNodeOutputMaterial'); mat.node_tree.links.new(shader.outputs[0],output.inputs['Volume']); volume.materials.append(mat)
            else:
                obj.hide_render=True; report['unsupported'].append('Raw field retained as processable volume; no invented density shader')
        elif kind=='gaussians' and not gaussian_available():
            report['unsupported'].append(representation['id']+': native Gaussian PointCloud unavailable; PLY retained without point fallback'); continue
        else:
            if path.suffix.lower()=='.glb': bpy.ops.import_scene.gltf(filepath=str(path))
            elif path.suffix.lower()=='.obj': bpy.ops.wm.obj_import(filepath=str(path),forward_axis='NEGATIVE_Z',up_axis='Y')
            elif path.suffix.lower()=='.ply': bpy.ops.wm.ply_import(filepath=str(path),forward_axis='NEGATIVE_Z',up_axis='Y')
            else: raise ValueError('Unsupported geometry suffix')
            objects=set(scene.objects)-before
            if kind=='gaussians' and not any(o.type=='POINTCLOUD' for o in objects):
                for obj in objects: bpy.data.objects.remove(obj,do_unlink=True)
                raise RuntimeError('PLY importer did not create native Gaussian PointCloud')
            for obj in objects:
                if obj.type=='MESH':
                    # Canonicalise imported colour layer identity, independent of importer defaults.
                    if obj.data.color_attributes: obj.data.color_attributes[0].name='Color'
                    source=materials[representation['materialId']]
                    if obj.data.color_attributes and representation.get('colorsIncludeBaseColor',False): source={**source,'baseColor':[1,1,1]}
                    mat=material(source,root,vertex=bool(obj.data.color_attributes))
                    obj.data.materials.clear(); obj.data.materials.append(mat)
                    for polygon in obj.data.polygons: polygon.use_smooth=True
                if kind=='points':
                    restore_point_attributes(obj,path)
                    obj['fraktalmotorn_representation']='points'
                    group=bpy.data.node_groups.new('Conventional point display','GeometryNodeTree')
                    group.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry')
                    group.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
                    entry=group.nodes.new('NodeGroupInput'); output=group.nodes.new('NodeGroupOutput')
                    sphere=group.nodes.new('GeometryNodeMeshIcoSphere'); sphere.inputs['Radius'].default_value=.004; sphere.inputs['Subdivisions'].default_value=1
                    instances=group.nodes.new('GeometryNodeInstanceOnPoints'); group.links.new(entry.outputs[0],instances.inputs['Points']); group.links.new(sphere.outputs['Mesh'],instances.inputs['Instance'])
                    realise=group.nodes.new('GeometryNodeRealizeInstances'); group.links.new(instances.outputs[0],realise.inputs[0])
                    assign=group.nodes.new('GeometryNodeSetMaterial'); assign.inputs['Material'].default_value=mat
                    group.links.new(realise.outputs[0],assign.inputs[0]); group.links.new(assign.outputs[0],output.inputs[0])
                    modifier=obj.modifiers.new('Point display (radius 0.004 scene unit)','NODES'); modifier.node_group=group
                    report['diagnostics'].append({'feature':'point-display','status':'APPROXIMATED','reason':'Geometry Nodes icospheres at radius 0.004; original point vertices remain editable. Not Gaussian Splats.'})
        for obj in set(scene.objects)-before:
            obj['fraktalmotorn_id']=representation['id']; obj['fraktalmotorn_representation']=kind
            report['objects'].append({'id':representation['id'],'name':obj.name,'type':obj.type})
    for primitive in data['primitives']:
        kind=primitive['type']
        if kind=='sphere': bpy.ops.mesh.primitive_uv_sphere_add(segments=64,ring_count=32,radius=1)
        elif kind=='box': bpy.ops.mesh.primitive_cube_add(size=2)
        elif kind=='plane': bpy.ops.mesh.primitive_plane_add(size=data['planeHalfSize']*2)
        else: raise ValueError('Unsupported primitive')
        obj=bpy.context.object; obj.name=primitive['id']; obj['fraktalmotorn_id']=primitive['id']
        rotation=Euler(tuple(math.radians(v) for v in primitive['rotation']),'XYZ').to_matrix().to_4x4()
        scale=Matrix.Diagonal(Vector((*primitive['scale'],1)))
        obj.matrix_world=C @ Matrix.Translation(Vector(primitive['position'])) @ rotation @ scale @ C.inverted()
        obj.hide_render=not primitive['enabled']; obj.hide_set(not primitive['enabled'])
        obj['fraktalmotorn_source']=json.dumps(primitive)
        obj.data.materials.append(material(materials[primitive['materialId']],root,primitive['color'],primitive=True))
        for polygon in obj.data.polygons: polygon.use_smooth=kind=='sphere'
        report['objects'].append({'id':primitive['id'],'name':obj.name,'type':'MESH','enabled':primitive['enabled']})
    c=data['camera']; basis=c['basis']; camera_data=bpy.data.cameras.new('Source camera')
    camera=bpy.data.objects.new('Source camera',camera_data); scene.collection.objects.link(camera)
    camera.matrix_world=Matrix((convert(basis['right']),convert(basis['up']),-convert(basis['forward']))).transposed().to_4x4()
    camera.location=convert(basis['position']); scene.camera=camera
    camera_data.sensor_fit='VERTICAL'; camera_data.sensor_width=c['sensorWidthMm']
    camera_data.sensor_height=c['sensorWidthMm']/(data['resolution']['width']/data['resolution']['height'])
    camera_data.lens=c['focalLengthMm']; camera_data.type='ORTHO' if c['source'].get('projection')=='orthographic' else 'PERSP'
    if camera_data.type=='ORTHO': camera_data.ortho_scale=c['source'].get('ortho_height',4)
    camera_data.clip_start=.001; camera_data.clip_end=1e6
    camera_data.dof.use_dof=camera_data.type=='PERSP' and c['source'].get('dof',{}).get('enabled',False) and c['apertureRadius']>0
    camera_data.dof.focus_distance=c['focusDistance']
    if c['apertureRadius']>0: camera_data.dof.aperture_fstop=max(.0001,c['focalLengthMm']/(2000*c['apertureRadius']))
    for index,light in enumerate(data['lights']):
        lamp=bpy.data.lights.new(light.get('name') or 'Source light '+str(index),{'directional':'SUN','point':'POINT','spot':'SPOT'}[light['type']])
        lamp.color=srgb_hex(light['color']); lamp.energy=light['intensity']*(math.pi if lamp.type=='SUN' else 4*math.pi**2)
        obj=bpy.data.objects.new(lamp.name,lamp); scene.collection.objects.link(obj)
        obj.location=convert(light['position']); obj.rotation_euler=convert(light['direction']).to_track_quat('-Z','Y').to_euler()
        obj.hide_render=not light['enabled']; obj.hide_set(not light['enabled']); lamp.use_shadow=light['shadows']!='none'
        softness=light['shadow_softness'] if light['shadows']=='soft' else 0
        if lamp.type=='SUN': lamp.angle=softness*.1
        else: lamp.shadow_soft_size=softness
        if lamp.type=='SPOT': lamp.spot_size=math.radians(light['cone_degrees']*2); lamp.spot_blend=light['cone_softness']
        obj['fraktalmotorn_source']=json.dumps(light)
    world=bpy.data.worlds.new('Source environment'); world.use_nodes=True; scene.world=world
    nodes=world.node_tree.nodes; links=world.node_tree.links; nodes.clear()
    environment=data['environment']; texture=nodes.new('ShaderNodeTexEnvironment'); texture.image=bpy.data.images.load(str(asset(root,environment['path'])),check_existing=True)
    coordinate=nodes.new('ShaderNodeTexCoord'); mapping=nodes.new('ShaderNodeMapping'); mapping.inputs['Rotation'].default_value=(0,0,math.radians(environment['rotationDegrees'])-math.pi/2)
    links.new(coordinate.outputs['Generated'],mapping.inputs['Vector']); links.new(mapping.outputs[0],texture.inputs[0])
    background=nodes.new('ShaderNodeBackground'); background.inputs['Strength'].default_value=environment['strength']; links.new(texture.outputs[0],background.inputs['Color'])
    output=nodes.new('ShaderNodeOutputWorld')
    if environment['backgroundVisible']: links.new(background.outputs[0],output.inputs['Surface'])
    else:
        camera_background=nodes.new('ShaderNodeBackground'); sky=nodes.new('ShaderNodeTexEnvironment'); sky.image=bpy.data.images.load(str(asset(root,environment['skyPath'])),check_existing=True)
        links.new(mapping.outputs[0],sky.inputs[0]); links.new(sky.outputs[0],camera_background.inputs['Color'])
        mix=nodes.new('ShaderNodeMixShader'); lightpath=nodes.new('ShaderNodeLightPath'); links.new(lightpath.outputs['Is Camera Ray'],mix.inputs[0])
        links.new(background.outputs[0],mix.inputs[1]); links.new(camera_background.outputs[0],mix.inputs[2]); links.new(mix.outputs[0],output.inputs[0])
    report['diagnostics'].append({'feature':'ambient/display','status':'APPROXIMATED','reason':'Cycles full environment illumination replaces native ambient approximation; Standard display differs from native exposure/ACES.'})
    scene.render.engine='CYCLES'; scene.cycles.samples=32; scene.view_settings.view_transform='Standard'
    scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=False
    scene['fraktalmotorn_report']=json.dumps(report)
    bpy.context.view_layer.update()
    return scene,report

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('manifest'); parser.add_argument('--save'); parser.add_argument('--render'); parser.add_argument('--usd'); parser.add_argument('--glb')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    scene,report=reconstruct(args.manifest)
    if args.glb:
        bpy.ops.export_scene.gltf(filepath=str(Path(args.glb).resolve()),export_format='GLB',use_active_scene=True,use_renderable=True,export_cameras=True,export_lights=True)
        report['glb']='EXPORTED: renderable conventional scene; disabled objects, procedural/volume/Gaussian fidelity require manifest'
    if args.usd:
        if not operator_available(bpy.ops.wm.usd_export): report['unsupported'].append('USD exporter unavailable')
        else:
            properties=bpy.ops.wm.usd_export.get_rna_type().properties
            settings={'filepath':str(Path(args.usd).resolve())}
            for key in ('export_materials','export_textures'):
                if key in properties: settings[key]=True
            bpy.ops.wm.usd_export(**settings)
            report['usd']='EXPORTED with installed Blender USD adapter; special representations remain in bundle'
    if args.save: bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.save).resolve()))
    if args.render:
        scene.render.filepath=str(Path(args.render).resolve()); bpy.ops.render.render(write_still=True)
    Path(args.manifest).with_name('blender-import-report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    print('SCENE_IMPORT_PASS',json.dumps(report))

def register_import_menu():
    from bpy_extras.io_utils import ImportHelper
    class FRACTAL_OT_scene_import(bpy.types.Operator,ImportHelper):
        bl_idname='import_scene.fraktalmotorn_bundle'
        bl_label='Import Fraktalmotorn Scene'
        filename_ext='.json'
        filter_glob:bpy.props.StringProperty(default='*.json',options={'HIDDEN'})
        def execute(self,context):
            try:
                if context.mode!='OBJECT': raise RuntimeError('Switch to Object Mode before importing')
                scene,report=reconstruct(self.filepath)
                self.report({'WARNING'} if report['unsupported'] else {'INFO'},'Imported '+str(len(report['objects']))+' objects; approximations in Scene custom properties / console')
                print('FRAKTALMOTORN_IMPORT_REPORT',json.dumps(report,indent=2))
                return {'FINISHED'}
            except Exception as error:
                self.report({'ERROR'},str(error)); return {'CANCELLED'}
    if hasattr(bpy.types,'FRACTAL_OT_scene_import'):
        bpy.utils.unregister_class(bpy.types.FRACTAL_OT_scene_import)
    bpy.utils.register_class(FRACTAL_OT_scene_import)
    # Re-running the helper replaces its own menu entry, rather than accumulating callbacks.
    old=bpy.app.driver_namespace.get('fraktalmotorn_import_menu')
    if old:
        try: bpy.types.TOPBAR_MT_file_import.remove(old)
        except Exception: pass
    def menu(self,context): self.layout.operator(FRACTAL_OT_scene_import.bl_idname,text='Fraktalmotorn Scene (.json)')
    bpy.types.TOPBAR_MT_file_import.append(menu);bpy.app.driver_namespace['fraktalmotorn_import_menu']=menu

if __name__=='__main__':
    if '--' in sys.argv: main()
    else: register_import_menu()
