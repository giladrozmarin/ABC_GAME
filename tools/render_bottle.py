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


# ---- classic glass ketchup bottle profile (2.4 tall, half-width max 0.6) ----
# wide faceted-look body, long tapering neck with a bead, white cap
glass_profile = [
    (0.30, 0.02),
    (0.33, 0.045),
    (0.34, 0.12),
    (0.34, 1.18),
    (0.33, 1.28),
    (0.28, 1.42),
    (0.215, 1.56),
    (0.165, 1.70),
    (0.142, 1.84),
    (0.132, 1.98),
    (0.13, 2.04),
    (0.145, 2.06),   # neck bead
    (0.145, 2.10),
    (0.127, 2.12),
    (0.127, 2.18),
]
glass = lathe('Glass', glass_profile)

# ketchup inside: same silhouette inset, filled up into the neck
ketchup_profile = [(max(r - 0.028, 0.02), z) for r, z in glass_profile if z <= 2.0]
ketchup_profile.append((0.095, 2.0))
ketchup = lathe('Ketchup', ketchup_profile)

# white screw cap
cap_profile = [
    (0.162, 2.14),
    (0.17, 2.16),
    (0.17, 2.36),
    (0.162, 2.385),
    (0.10, 2.40),
]
cap = lathe('Cap', cap_profile)


# ---- materials ----
def material(name, setup):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    setup(m.node_tree.nodes['Principled BSDF'])
    return m


def glass_mat(b):
    b.inputs['Base Color'].default_value = (0.92, 0.95, 0.94, 1)
    b.inputs['Roughness'].default_value = 0.03
    b.inputs['IOR'].default_value = 1.5
    if 'Transmission Weight' in b.inputs:
        b.inputs['Transmission Weight'].default_value = 1.0


def ketchup_mat(b):
    b.inputs['Base Color'].default_value = (0.40, 0.016, 0.005, 1)
    b.inputs['Roughness'].default_value = 0.34
    if 'Subsurface Weight' in b.inputs:
        b.inputs['Subsurface Weight'].default_value = 0.08
        b.inputs['Subsurface Radius'].default_value = (0.2, 0.04, 0.02)


def cap_mat(b):
    b.inputs['Base Color'].default_value = (0.88, 0.87, 0.85, 1)
    b.inputs['Roughness'].default_value = 0.32


glass.data.materials.append(material('Glass', glass_mat))
ketchup.data.materials.append(material('Ketchup', ketchup_mat))
cap.data.materials.append(material('CapWhite', cap_mat))

# ---- shadow catcher floor ----
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
floor = bpy.context.object
floor.is_shadow_catcher = True

# ---- camera (orthographic front view) ----
cam_data = bpy.data.cameras.new('Cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 2.56
cam = bpy.data.objects.new('Cam', cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (0, -8, 1.17)
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


area('Key', (-3.2, -4.2, 3.4), (math.radians(55), 0, math.radians(-38)), 650, 3.0, (1.0, 0.96, 0.9))
area('Fill', (3.4, -4.0, 1.6), (math.radians(72), 0, math.radians(42)), 150, 5.0, (0.9, 0.94, 1.0))
area('Rim', (2.6, 3.6, 3.0), (math.radians(-60), 0, math.radians(145)), 1100, 2.0)
# soft strip behind for glass edges
area('Back', (0, 4.5, 1.2), (math.radians(-90), 0, 0), 220, 6.0)

world = bpy.data.worlds.new('W')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.05
bpy.context.scene.world = world

# ---- render settings ----
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 192
sc.cycles.use_denoising = True
sc.cycles.device = 'CPU'
sc.render.film_transparent = True
if hasattr(sc.render, 'film_transparent_glass'):
    sc.render.film_transparent_glass = True
sc.render.resolution_x = 560
sc.render.resolution_y = 1120
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.look = 'AgX - High Contrast'
sc.render.filepath = OUT

bpy.ops.render.render(write_still=True)
print('RENDER DONE:', OUT)
