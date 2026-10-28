"""Original storyboard renderer. See docs/LANDING-VIDEO.md for provenance and setup.
No app, auth, database, browser, model or network calls are made by this script.
"""
from pathlib import Path
import json
import subprocess
import os
from PIL import Image, ImageDraw, ImageFont, ImageOps
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'apps/web/public/landing-video'
OUT.mkdir(parents=True, exist_ok=True)
W, H, FPS, DURATION = 1280, 720, 24, 50
INK, MUTED, CREAM, YELLOW, LINE = '#292820', '#6b685d', '#f4f0e6', '#f5ff80', '#ddd7ca'
FONT = Path(os.environ.get('LANDING_VIDEO_FONT', '/System/Library/Fonts/Supplemental/Arial.ttf'))
BOLD = Path(os.environ.get('LANDING_VIDEO_BOLD_FONT', '/System/Library/Fonts/Supplemental/Arial Bold.ttf'))
fonts = {}
def f(size, bold=False):
    key = (size, bold)
    if key not in fonts: fonts[key] = ImageFont.truetype(str(BOLD if bold else FONT), size)
    return fonts[key]
def text(draw, xy, value, size=24, color=INK, bold=False):
    draw.text(xy, value, font=f(size, bold), fill=color, spacing=10)
def box(draw, xy, fill='white', outline=LINE, radius=14):
    draw.rounded_rectangle(xy, radius, fill=fill, outline=outline, width=2)
def pill(draw, x, y, label, active=True):
    width = int(draw.textlength(label, font=f(19, True))) + 32
    box(draw, (x,y,x+width,y+36), YELLOW if active else CREAM, YELLOW if active else LINE, 8)
    text(draw, (x+16,y+7), label, 19, bold=True)
def field(draw, x, y, label, value, width=600):
    text(draw,(x,y),label.upper(),17,MUTED,True)
    box(draw,(x,y+30,x+width,y+84),CREAM)
    text(draw,(x+16,y+45),value,23)

def shell(title, role, step):
    im=Image.new('RGB',(W,H),CREAM); d=ImageDraw.Draw(im)
    d.rectangle((0,0,W,68),fill=INK)
    text(d,(34,21),'SUPREME',23,YELLOW,True)
    text(d,(220,24),'MAINTENANCE INTELLIGENCE',16,'#eeeadf')
    text(d,(920,24),'ILLUSTRATIVE PRODUCT DEMO',15,'#eeeadf')
    d.rectangle((0,68,215,H),fill='#ebe5d7')
    text(d,(26,99),'WORKSPACE',16,MUTED,True)
    for i,label in enumerate(['Machine overview','Work orders','Calendar','Manuals & SOPs','Assistant']):
        y=153+i*62
        if (i==1 and step<5) or (i==2 and step==5):
            box(d,(14,y-12,201,y+35),YELLOW,YELLOW,7)
        text(d,(26,y),label,19,bold=(i==1 and step<5))
    text(d,(26,588),'SAMPLE MACHINE',14,MUTED,True)
    text(d,(26,616),'DEMO-01',23,bold=True)
    text(d,(251,97),'FEATURE TOUR' if step == 6 else f'0{step} / 05',17,MUTED,True)
    text(d,(251,131),title,38,bold=True)
    pill(d,947,99,role)
    return im

motor=ImageOps.fit(Image.open(Path(__file__).with_name('motor-concept.png')).convert('RGB'),(W,H))
scenes=[]
# Opening visual: only generated raster; all typography/UI below is deterministic.
im=motor.copy(); d=ImageDraw.Draw(im)
text(d,(60,66),'SUPREME / MAINTENANCE',20,bold=True)
text(d,(60,190),'One issue.\nEvery handoff.',56,bold=True)
text(d,(62,368),'From the first report\nto a human-reviewed record.',25)
pill(d,62,480,'SEE THE WORKFLOW')
text(d,(62,653),'AI-ASSISTED MOTION DEMO  /  CONCEPT VISUAL + SAMPLE INTERFACE',16,MUTED)
scenes.append(im)

im=shell('Start with what you observed.','Operator',1); d=ImageDraw.Draw(im)
box(d,(251,203,1228,624))
field(d,279,229,'Issue title','Unusual sound near the drive',620)
field(d,279,337,'Machine','DEMO-01 / Sample equipment',620)
text(d,(279,451),'OBSERVATION & EVIDENCE',17,MUTED,True)
text(d,(279,486),'Record the symptom. Attach a photo or document.',24)
pill(d,279,558,'Report issue')
text(d,(944,263),'REPORTED',22,bold=True)
text(d,(944,311),'Original report\nretained in history',21,MUTED)
text(d,(251,652),'A clear starting point. No automatic diagnosis.',23)
scenes.append(im)

im=shell('Give the work a clear owner.','Maintenance head',2); d=ImageDraw.Draw(im)
box(d,(251,203,1228,624))
pill(d,279,229,'REPORTED',False)
text(d,(279,292),'Unusual sound near the drive',31,bold=True)
field(d,279,359,'Eligible technician','Sample technician',600)
pill(d,279,488,'Assign technician')
d.line((948,266,948,519),fill=LINE,width=3)
for y,lab in [(279,'Report'),(377,'Assign'),(475,'In progress')]:
    d.ellipse((934,y,962,y+28),fill=YELLOW if y<400 else CREAM,outline=INK,width=2)
    text(d,(984,y+1),lab,22,bold=y==377)
text(d,(279,566),'Assignment is an explicit head action.',22,MUTED)
text(d,(251,652),'Trusted roles. Machine-scoped access.',23)
scenes.append(im)

im=shell('Keep findings and evidence together.','Technician',3); d=ImageDraw.Draw(im)
box(d,(251,203,844,624)); box(d,(866,203,1228,624))
pill(d,279,224,'IN PROGRESS',False)
for y,label,value in [(285,'Findings','Document inspection observations'),(374,'Work performed','Record the corrective action'),(463,'Restoration time','Recorded separately from review')]:
    text(d,(279,y),label.upper(),17,MUTED,True); text(d,(279,y+30),value,23)
pill(d,279,563,'Submit for head review')
text(d,(891,230),'REPAIR RECORD',19,bold=True)
for y,label in [(291,'Findings'),(339,'Human RCA'),(387,'Corrective action'),(435,'Preventive action'),(483,'Private evidence')]:
    d.ellipse((892,y+3,911,y+22),fill=YELLOW); text(d,(927,y),label,22)
text(d,(891,556),'Retained with history',20,MUTED)
text(d,(251,652),'The assigned technician submits the repair record.',23)
scenes.append(im)

im=shell('Review is a human decision.','Maintenance head',4); d=ImageDraw.Draw(im)
box(d,(251,203,1228,624)); pill(d,279,228,'AWAITING REVIEW',False)
text(d,(279,292),'Review the complete submission',33,bold=True)
text(d,(279,353),'Findings  /  evidence  /  RCA  /  actions',25)
text(d,(279,403),'Restoration and review keep their own timestamps.',24,MUTED)
pill(d,279,472,'Approve'); pill(d,436,472,'Return with reason',False)
d.line((279,539,1198,539),fill=LINE,width=2)
text(d,(279,565),'After approval: head or supervisor closes the work.',24)
text(d,(251,652),'Approval and closure are separate, recorded handoffs.',23)
scenes.append(im)

im=shell('Keep the next job in context.','Team workspace',5); d=ImageDraw.Draw(im)
box(d,(251,203,719,624)); box(d,(741,203,1228,624))
text(d,(279,231),'Maintenance calendar',27,bold=True)
pill(d,279,281,'FIXED IST DATES',False)
for row in range(3):
    for col in range(7):
        x,y=279+col*58,347+row*57
        box(d,(x,y,x+47,y+44),YELLOW if (row,col)==(1,3) else CREAM,LINE,6)
text(d,(279,542),'Head releases planned work.',23)
text(d,(279,578),'Planned completion stays separate.',20,MUTED)
text(d,(768,231),'Manual-grounded assistant',27,bold=True)
box(d,(768,287,1200,376),CREAM)
text(d,(786,305),'Find approved inspection\nguidance for this machine.',23)
text(d,(768,409),'Approved manuals & SOPs',23,bold=True)
text(d,(768,452),'Cited source passages\nRetained reference versions\nGuidance for human review',22,MUTED)
text(d,(768,570),'Advisory. People decide.',22,bold=True)
text(d,(251,652),'Connected records. Better context for the next decision.',23)
scenes.append(im)

def feature_scene(title, role, heading, lines, footer):
    im = shell(title, role, 6); d = ImageDraw.Draw(im)
    box(d, (251, 203, 1228, 624))
    text(d, (280, 235), heading, 32, bold=True)
    for i, (label, detail) in enumerate(lines):
        y = 305 + i * 92
        box(d, (279, y, 1197, y + 72), CREAM, LINE, 10)
        pill(d, 297, y + 18, label, i == 0)
        text(d, (540, y + 23), detail, 21)
    text(d, (251, 652), footer, 23)
    return im

scenes.extend([
    feature_scene('A workspace for every machine.', 'Administrator', 'Machine registry', [
        ('ASSETS', 'Register equipment and maintain machine details'),
        ('ACCESS', 'Grant appropriate machine access'),
        ('OVERVIEW', 'Keep a machine photo and its records together')], 'A single place to find your equipment.'),
    feature_scene('See production in context.', 'Team workspace', 'Production & process trends', [
        ('PRODUCTION', 'Import and review production workbooks'),
        ('TRENDS', 'Explore process readings over time'),
        ('PATTERNS', 'Review statistical flags with supporting evidence')], 'Review data with its source and context.'),
    feature_scene('Stay on top of work.', 'Team workspace', 'Maintenance coordination', [
        ('CALENDAR', 'Plan recurring maintenance on fixed dates'),
        ('ALERTS', 'See assignments and workflow handoffs'),
        ('REPORTS', 'Explore maintenance records and reports')], 'The right context for the next handoff.'),
    feature_scene('Put knowledge to work.', 'Team workspace', 'Manuals, SOPs & AI assistance', [
        ('REFERENCES', 'Maintain approved machine documents'),
        ('ASSISTANT', 'Ask questions and view source references'),
        ('AI RCA', 'Draft from evidence for technician and head review')], 'AI supports people; people make the decisions.'),
])

starts=[0,3,8,13,19,24,30,35,40,45]; durations=[3,5,5,6,5,6,5,5,5,5]
# Poster foregrounds the actual product narrative instead of a generic machine alone.
scenes[1].save(OUT/'poster.jpg',quality=90,optimize=True)
for i,im in enumerate(scenes):
    im.save(ROOT/'.local'/f'landing-video-scene-{i}.jpg',quality=90)
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
cmd=[ffmpeg,'-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','medium','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',str(OUT/'maintenance-demo.mp4')]
p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=subprocess.DEVNULL)
for frame in range(FPS*DURATION):
    t=frame/FPS
    idx=max(i for i,s in enumerate(starts) if t>=s)
    local=t-starts[idx]
    current=scenes[idx]
    # Short editorial dissolve, then a subtle controlled push-in; no flashing.
    if local<.55:
        current=Image.blend(scenes[idx-1],current,local/.55)
    else:
        scale=1+.035*min(local/durations[idx],1)
        enlarged=current.resize((int(W*scale),int(H*scale)),Image.Resampling.BICUBIC)
        current=ImageOps.fit(enlarged,(W,H),centering=(.5,.5))
    # A moving cursor and expanding halo bring each illustrated interaction to life.
    if idx and local > .7:
        d=ImageDraw.Draw(current)
        phase=min((local-.7)/1.5,1)
        x=int(1060-(idx%3)*120 + 75*(1-phase)); y=int(500-(idx%2)*120 + 45*(1-phase))
        if 1.5 < local < 2.4:
            radius=int(10+20*(local-1.5))
            d.ellipse((x-radius,y-radius,x+radius,y+radius),outline=INK,width=3)
        d.polygon([(x,y),(x+3,y+30),(x+11,y+22),(x+20,y+39),(x+26,y+36),(x+17,y+19),(x+29,y+17)],fill=INK,outline='white',width=2)
    p.stdin.write(current.tobytes())
p.stdin.close()
if p.wait(): raise SystemExit('ffmpeg export failed')
metadata={'durationSeconds':DURATION,'width':W,'height':H,'fps':FPS,'codec':'H.264','pixelFormat':'yuv420p','audio':False,'bytes':(OUT/'maintenance-demo.mp4').stat().st_size,'method':'AI-generated concept still + deterministic original UI storyboard + Pillow motion rendering + ffmpeg encoding','sceneStartsSeconds':starts}
(OUT/'metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata,indent=2))
