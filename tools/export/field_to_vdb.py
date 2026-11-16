"""Own format adapter. Uses the installed Blender OpenVDB Python library, without installing dependencies.
Input stays a raw field/density with its validity; an unknown/unsigned DE never gets LEVEL_SET classification.
"""
import json
from pathlib import Path
import numpy as np
import openvdb

def convert_field(metadata_path, output_path, density_floor=1e-5):
    metadata_path = Path(metadata_path).resolve()
    root = metadata_path.parent
    meta = json.loads(metadata_path.read_text(encoding='utf8'))
    if meta.get('format') != 'fraktalmotorn-field' or meta.get('version') != 1:
        raise ValueError('Unsupported field manifest')
    def asset(name):
        target = (root / name).resolve()
        if not target.is_relative_to(root): raise ValueError('Asset path escapes field bundle')
        return target
    nx, ny, nz = meta['dimensions']
    if min(nx,ny,nz) < 2 or nx*ny*nz > 64_000_000: raise ValueError('Invalid volume budget')
    raw = np.memmap(asset(meta['files']['values']), dtype='<f4', mode='r', shape=(nz,ny,nx))
    mask = np.memmap(asset(meta['files']['validity']), dtype='u1', mode='r', shape=(nz,ny,nx))
    sx,sy,sz = meta['spacing']; ox,oy,oz = meta['origin']
    transform = openvdb.createLinearTransform(matrix=[[sx,0,0,0],[0,0,sy,0],[0,-sz,0,0],[ox,-oz,oy,1]])
    field = openvdb.FloatGrid(0.0)
    field.name = 'density' if meta['mode']=='surface-density' else 'occupancy' if meta['mode']=='occupancy' else 'field'
    field.transform = transform
    field['fraktalmotorn:input_semantics'] = meta['inputSemantics']
    field['fraktalmotorn:mode'] = meta['mode']
    field['fraktalmotorn:iso_level'] = float(meta['isoLevel'])
    field['fraktalmotorn:coordinate_system'] = 'Blender right-handed Z-up; (x,-z,y)'
    # Even exact signed samples within bounds cannot certify the unrepresented exterior / sparse background.
    # Keep raw fields UNKNOWN; original signed-distance semantics remain explicit metadata.
    field.gridClass = openvdb.GridClass.FOG_VOLUME if meta['mode']=='surface-density' else openvdb.GridClass.UNKNOWN
    validity = openvdb.FloatGrid(0.0); validity.name = 'validity'; validity.transform = transform
    peak = 0
    for z in range(0,nz,8):
        slab = np.array(raw[z:z+8],dtype=np.float32)
        valid = np.array(mask[z:z+8],dtype=np.float32)
        slab[(valid==0)|~np.isfinite(slab)] = 0
        if meta['mode']=='surface-density': slab[slab < density_floor] = 0
        field.copyFromArray(np.ascontiguousarray(slab.transpose(2,1,0)),ijk=(0,0,z))
        validity.copyFromArray(np.ascontiguousarray(valid.transpose(2,1,0)),ijk=(0,0,z))
        peak = max(peak,slab.nbytes*4) # four transient slab arrays, excluding VDB tree/native library
    field['fraktalmotorn:density_floor'] = float(density_floor if meta['mode']=='surface-density' else 0)
    openvdb.write(str(output_path),grids=[field,validity])
    # Independent round-trip through the installed library, including exact world transform.
    loaded = openvdb.read(str(output_path),field.name)
    accessor = loaded.getConstAccessor()
    for xyz in ((0,0,0),(nx//2,ny//2,nz//2),(nx-1,ny-1,nz-1),(nx//3,ny//3,nz//3)):
        x,y,z = xyz
        expected = float(raw[z,y,x]) if mask[z,y,x] and np.isfinite(raw[z,y,x]) else 0
        if meta['mode']=='surface-density' and expected < density_floor: expected = 0
        assert abs(accessor.getValue(xyz)-expected) < 1e-6
        world = loaded.transform.indexToWorld(xyz)
        assert np.allclose(world,(ox+x*sx,-oz-z*sz,oy+y*sy),atol=1e-6)
    return {'grid':field.name,'class':str(field.gridClass),'activeVoxels':field.activeVoxelCount(),'vdbTreeBytes':field.memUsage()+validity.memUsage(),
        'bytes':Path(output_path).stat().st_size,'peakSlabArrayBytes':peak,'dimensions':[nx,ny,nz],
        'inputSemantics':meta['inputSemantics'],'densityFloor':density_floor if meta['mode']=='surface-density' else 0,
        'roundTrip':'PASS','version':str(getattr(openvdb,'__version__','bundled'))}

if __name__=='__main__':
    import sys
    args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]
    print(json.dumps(convert_field(args[0],args[1]),indent=2))
