import bpy
import math

OUT = '/tmp/claude-0/-home-user-ABC-GAME/f61e628f-7d95-53be-9ef7-6c7ea1a615fc/scratchpad/bottle.png'

# ---- clean scene ----
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()

SEG = 128  # radial segments


def lathe(name, profile, close_top=True, close_bottom=True):
    """Surface of revolution from (radius, z, facet) triples.

    facet 0..1 blends the cross-section from a circle toward a subtle
    octagon (flat-front), like a classic faceted glass bottle body.
    """
    verts, faces = [], []
    rings = []
    for r, z, f in profile:
        ring = []
        for i in range(SEG):
            a = 2 * math.pi * i / SEG
            # fold angle into one octagon sector, [-22.5deg, 22.5deg]
            sector = math.pi / 4
            a8 = ((a + sector / 2) % sector) - sector / 2
            r_oct = r / math.cos(a8)
            rr = r * (1 - f) + r_oct * f
            ring.append(len(verts))
            verts.append((rr * math.cos(a), rr * math.sin(a), z))
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


# ---- classic glass ketchup bottle (2.4 tall) ----
# faceted body, long concave shoulder cone, short neck with flange, white cap
glass_profile = [
    (0.295, 0.02, 0.55),
    (0.32, 0.05, 0.55),
    (0.33, 0.14, 0.55),
    (0.33, 1.05, 0.55),
    (0.325, 1.14, 0.4),
    (0.30, 1.26, 0.15),
    (0.26, 1.40, 0.0),
    (0.215, 1.54, 0.0),
    (0.175, 1.68, 0.0),
    (0.148, 1.82, 0.0),
    (0.132, 1.94, 0.0),
    (0.126, 2.04, 0.0),
    (0.126, 2.08, 0.0),
    (0.142, 2.095, 0.0),  # flange under the cap
    (0.142, 2.13, 0.0),
    (0.124, 2.145, 0.0),
    (0.124, 2.20, 0.0),
]
glass = lathe('Glass', glass_profile)

# ketchup inside: inset silhouette, filled up into the neck
ketchup_profile = [(max(r - 0.026, 0.02), z, f) for r, z, f in glass_profile if z <= 2.02]
ketchup_profile.append((0.09, 2.02, 0.0))
ketchup = lathe('Ketchup', ketchup_profile)

# short white screw cap
cap_profile = [
    (0.155, 2.16, 0),
    (0.163, 2.18, 0),
    (0.163, 2.34, 0),
    (0.155, 2.36, 0),
    (0.10, 2.375, 0),
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
    b.inputs['Base Color'].default_value = (0.46, 0.026, 0.007, 1)
    b.inputs['Roughness'].default_value = 0.30
    if 'Subsurface Weight' in b.inputs:
        b.inputs['Subsurface Weight'].default_value = 0.1
        b.inputs['Subsurface Radius'].default_value = (0.25, 0.05, 0.02)


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

# ---- camera (orthographic front view, facing an octagon flat) ----
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


area('Key', (-3.2, -4.2, 3.4), (math.radians(55), 0, math.radians(-38)), 800, 2.4, (1.0, 0.97, 0.92))
area('Fill', (3.4, -4.0, 1.6), (math.radians(72), 0, math.radians(42)), 200, 5.0, (0.9, 0.94, 1.0))
area('Rim', (2.6, 3.6, 3.0), (math.radians(-60), 0, math.radians(145)), 1100, 2.0)
area('Back', (0, 4.5, 1.2), (math.radians(-90), 0, 0), 240, 6.0)

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
sc.view_settings.look = 'AgX - Medium High Contrast'
sc.render.filepath = OUT

bpy.ops.render.render(write_still=True)
print('RENDER DONE:', OUT)
