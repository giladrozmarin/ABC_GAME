import bpy
import math

OUT = '/tmp/claude-0/-home-user-ABC-GAME/f61e628f-7d95-53be-9ef7-6c7ea1a615fc/scratchpad/bottle.png'

# ---- clean scene ----
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

SEG = 96  # radial segments


def lathe(name, profile, close_top=True, close_bottom=True):
    """Build a surface of revolution from a list of (radius, z) pairs."""
    verts, faces = [], []
    rings = []
    for r, z in profile:
        ring = []
        for i in range(SEG):
            a = 2 * math.pi * i / SEG
            ring.append(len(verts))
            verts.append((r * math.cos(a), r * math.sin(a), z))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for i in range(SEG):
            j = (i + 1) % SEG
            faces.append((a[i], a[j], b[j], b[i]))
    if close_bottom:
        c = len(verts)
        verts.append((0, 0, profile[0][1]))
        ring = rings[0]
        for i in range(SEG):
            faces.append((ring[(i + 1) % SEG], ring[i], c))
    if close_top:
        c = len(verts)
        verts.append((0, 0, profile[-1][1]))
        ring = rings[-1]
        for i in range(SEG):
            faces.append((ring[i], ring[(i + 1) % SEG], c))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for p in mesh.polygons:
        p.use_smooth = True
    return obj


# ---- bottle body profile (units: bottle is 2.4 tall, max half-width 0.6) ----
body_profile = [
    (0.28, 0.015),
    (0.345, 0.03),
    (0.375, 0.08),
    (0.385, 0.18),
    (0.385, 1.45),
    (0.38, 1.55),
    (0.345, 1.68),
    (0.27, 1.82),
    (0.185, 1.94),
    (0.145, 2.02),
    (0.135, 2.08),
    (0.135, 2.14),
]
body = lathe('Body', body_profile)

# ---- cap ----
cap_profile = [
    (0.165, 2.10),
    (0.175, 2.12),
    (0.175, 2.34),
    (0.165, 2.37),
    (0.10, 2.39),
]
cap = lathe('Cap', cap_profile)

# ---- materials ----
def principled(name, color, rough, spec=0.5, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = spec
    if coat and 'Coat Weight' in bsdf.inputs:
        bsdf.inputs['Coat Weight'].default_value = coat
    return m

red = principled('RedPlastic', (0.30, 0.008, 0.005), 0.16, spec=0.55, coat=0.7)
dark = principled('CapPlastic', (0.05, 0.003, 0.003), 0.32, spec=0.4)
body.data.materials.append(red)
cap.data.materials.append(dark)

# ---- shadow catcher floor ----
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
floor = bpy.context.object
floor.is_shadow_catcher = True

# ---- camera (orthographic front view) ----
cam_data = bpy.data.cameras.new('Cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.55  # frames the 2.4-tall bottle with a little air
cam = bpy.data.objects.new('Cam', cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (0, -8, 1.16)
cam.rotation_euler = (math.pi / 2, 0, 0)
bpy.context.scene.camera = cam

# ---- lights ----
def area(name, loc, rot, energy, size, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, 'AREA')
    d.energy = energy
    d.size = size
    d.color = color
    o = bpy.data.objects.new(name, d)
    o.location = loc
    o.rotation_euler = rot
    bpy.context.collection.objects.link(o)
    return o

# key: front-left, slightly warm
area('Key', (-3.2, -4.2, 3.4), (math.radians(55), 0, math.radians(-38)), 620, 3.0, (1.0, 0.96, 0.9))
# fill: front-right, cool and soft
area('Fill', (3.4, -4.0, 1.6), (math.radians(72), 0, math.radians(42)), 130, 5.0, (0.9, 0.94, 1.0))
# rim: behind-right for edge separation
area('Rim', (2.6, 3.6, 3.0), (math.radians(-60), 0, math.radians(145)), 950, 2.0)

world = bpy.data.worlds.new('W')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.06
bpy.context.scene.world = world

# ---- render settings ----
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 128
sc.cycles.use_denoising = True
sc.cycles.device = 'CPU'
sc.render.film_transparent = True
sc.render.resolution_x = 560
sc.render.resolution_y = 1120
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.look = 'AgX - High Contrast'
sc.render.filepath = OUT

bpy.ops.render.render(write_still=True)
print('RENDER DONE:', OUT)
