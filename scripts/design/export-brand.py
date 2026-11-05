from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parents[2]
size = 1024
im = Image.new('RGBA', (size, size), (0,0,0,0))
d = ImageDraw.Draw(im)
d.rounded_rectangle((0,0,size-1,size-1),radius=224,fill='#153b3b')
for x, r, top in [(192,320,144),(352,160,304)]:
    d.arc((x,top,x+r*2,top+r*2),180,360,fill='#bde4d4',width=64)
    y=top+r
    d.rectangle((x,y,x+63,848),fill='#bde4d4')
    d.rectangle((x+r*2-63,y,x+r*2,848),fill='#bde4d4')
d.rectangle((480,576,543,848),fill='#bde4d4')
out=root/'apps/web/public/brand'
im.save(out/'riwaq-icon.png')
icons=root/'apps/desktop/src-tauri/icons'
for filename,px in [('32x32.png',32),('128x128.png',128),('128x128@2x.png',256)]:
    im.resize((px,px),Image.Resampling.LANCZOS).save(icons/filename)
im.save(icons/'icon.ico',sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
