[![中文](https://img.shields.io/badge/中文-f2e3e3?style=for-the-badge&labelColor=f2e3e3&color=b07070)](README.md)
[![English](https://img.shields.io/badge/English-f2e3e3?style=for-the-badge&labelColor=f2e3e3&color=b07070)](README.en.md)
[![ไทย](https://img.shields.io/badge/ไทย-8b1a1a?style=for-the-badge)](README.th.md)

# novel-outline

ดัดแปลงนิยายเป็นโครงเรื่องละครสั้น 5 ส่วน: แนวทางการดัดแปลง ตารางตัวละครแบ่งลำดับความสำคัญ ตารางจุดพีคของเรื่อง เรื่องย่อรายตอน และรายการทรัพยากรสำหรับผลิต การตัดสินใจสำคัญต้องอ้างข้อความต้นฉบับแบบคำต่อคำเสมอ

ผลลัพธ์คือ `outline.json` รายงาน Markdown และ `outline-report.html` แบบไฟล์เดียวที่เปิดแบบออฟไลน์ได้

## ภาษา

- `lang` กำหนดภาษาของหน้ารายงาน: `zh`, `th`, `en` มีมาให้ในตัว ลำดับความสำคัญคือ `--lang` > ฟิลด์ `lang` ใน JSON > ค่าเริ่มต้น `zh`
- `contentLang` กำหนดภาษาของเนื้อเรื่อง: `zh` (ค่าเริ่มต้น), `th`, `en` — ใช้กับกฎตรวจบทพูดและคำที่บ่งชี้ความเสี่ยงการผลิต
- การเปลี่ยนภาษาหน้ารายงานไม่แปลเนื้อหาเรื่องให้เอง
- การนับความยาวภาษาไทยไม่นับสระและวรรณยุกต์แบบ combining

ตัวอย่างการใช้งาน:

```bash
node scripts/novel-outline.mjs render examples/渡口-outline.json --html --lang th > /tmp/outline-th.html
node scripts/novel-outline.mjs render examples/渡口-outline.json --html --lang en > /tmp/outline-en.html
```

## ด่านคุณภาพเป็นโค้ด

หัวใจของ skill นี้คือ **เช็กลิสต์ที่ให้โมเดลประเมินตัวเองไม่มีประโยชน์** ด่านคุณภาพทั้ง 14 ด่านเป็นการตรวจแบบกำหนดผลได้ใน `validate` ได้แก่ เพดานจำนวนตัวละครแต่ละลำดับ เพดานฉากหลักที่ปรับตามจำนวนตอน แผนการใช้ซ้ำของฉากครั้งเดียว ช่องว่างของจุดพีค ฮุคตอนแรก ความพร้อมของข้อมูลอ้างอิง และการห้ามใส่บทพูดในเรื่องย่อ ตัวเลขของแต่ละด่านปรับได้ผ่าน `params.thresholds`

## ขั้นตอนทำงาน

1. นิยายยาวใช้ `chunk` แบ่งเป็นเล่มตามหัวข้อบทแล้วสรุปพร้อมกัน แล้วจึงรวมเป็นโครงเรื่อง ตัดสินใจตัด/รวม/วางจุดพีคก่อนเขียนเรื่องย่อรายตอน
2. ใช้ `validate --stage beats` กั้นจังหวะงาน: ต้องได้รับการยืนยันโครงเรื่องก่อน จึงจะเขียนเรื่องย่อรายตอนต่อได้
3. เขียนเรื่องย่อทีละไม่เกิน 10 ตอน แล้วใช้ `validate` ให้ผ่านทุกด่าน
4. ใช้ `render` ออกรายงานหรือ `assets` ดึงรายการทรัพยากร

คำสั่งหลัก:

```bash
node scripts/novel-outline.mjs chunk book.txt /tmp/work
node scripts/novel-outline.mjs validate outline.json
node scripts/novel-outline.mjs checkup outline.json
node scripts/novel-outline.mjs render outline.json --html --lang th > outline-report.html
node scripts/selftest.mjs
```

ตัวอย่าง `examples/渡口-outline.json` ใช้ทดสอบรายงานสามภาษาและด่านคุณภาพโดยไม่เรียกโมเดล ตัวตรวจรองรับหัวข้อบทภาษาไทยสำหรับการแบ่งเล่มด้วย
