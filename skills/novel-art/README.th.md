[![中文](https://img.shields.io/badge/中文-f2e3e3?style=for-the-badge&labelColor=f2e3e3&color=b07070)](README.md)
[![English](https://img.shields.io/badge/English-f2e3e3?style=for-the-badge&labelColor=f2e3e3&color=b07070)](README.en.md)
[![ไทย](https://img.shields.io/badge/ไทย-8b1a1a?style=for-the-badge)](README.th.md)

# novel-art

ออกแบบงานศิลป์สำหรับผลิตละครสั้นด้วย AI: ฉากและอุปกรณ์ประกอบที่มีบทบาทในเรื่อง วางไว้บนข้อตั้งที่ว่า **ทุกอย่างสร้างด้วยการ generate ไม่ใช่การถ่ายทำ** — ฉากและอุปกรณ์ต้องถูกสร้างใหม่หลายสิบครั้งแล้วยังต้องดูเหมือนเดิมทุกครั้ง สิ่งที่ skill นี้ส่งมอบจึงเป็นแผนรักษาความสม่ำเสมอของภาพ

- **ฉาก**: จุดยึดความสม่ำเสมอ 3–5 จุดต่อฉาก สถานะแสง และกลไกภาพแปรผันผ่าน `variantOf`
- **อุปกรณ์ประกอบ**: เฉพาะตัวที่มีบทบาททางเนื้อเรื่อง มีตัวแปรสถานะ (กระเป๋าปิดกับเปิดคือสองรูปอ้างอิง) มีวลีเทียบขนาดเขียนไว้ในพรอมต์ทุกฉบับ และเป็นภาพพื้นขาวไม่มีมือ
- **พรอมต์สำหรับโมเดลภาพเป็นภาษาอังกฤษเสมอ** ไม่ว่าจะตั้งภาษาใด

ผลลัพธ์คือ `art.json` รายงาน Markdown และ `art-report.html` แบบไฟล์เดียว

## ภาษา

- `lang` กำหนดภาษาของหน้ารายงาน: `zh`, `th`, `en` มีมาให้ในตัว ลำดับความสำคัญคือ `--lang` > ฟิลด์ `lang` ใน JSON > ค่าเริ่มต้น `zh`
- `contentLang` กำหนดภาษาของเนื้อหา: ค่าเริ่มต้น `zh` รองรับ `th` และ `en` — ชุดค่าขนาดของอุปกรณ์ประกอบเปลี่ยนตามภาษาเนื้อหา
- การเปลี่ยนภาษาหน้ารายงานไม่แปลเนื้อหาเรื่องให้เอง

ตัวอย่างการใช้งาน:

```bash
node scripts/novel-art.mjs render examples/渡口-art.json --html --lang th > /tmp/art-th.html
node scripts/novel-art.mjs render examples/渡口-art.json --html --lang en > /tmp/art-en.html
```

## ด่านคุณภาพเป็นโค้ด

ด่านคุณภาพทั้ง 10 ด่านตรวจแบบกำหนดผลได้ใน `validate`: จุดยึดความสม่ำเสมอ 3–5 จุด (ทั้งฉากและอุปกรณ์) สถานะแสงอย่างน้อย 1 สถานะต่อฉาก ห้ามคนใน negative prompt ทุกฉบับ พรอมต์ต้องเป็นภาษาอังกฤษ ห้ามชื่อตัวละคร การอ้างอิงภาพแปรผันครบ สถานะอุปกรณ์อย่างน้อย 1 สถานะ มีวลีเทียบขนาดในพรอมต์ และพื้นหลังขาวล้วน

## ขั้นตอนทำงาน

1. มี `outline.json` ให้ใช้ `seed` เติมรายชื่อฉากและอุปกรณ์พร้อมตอนที่ปรากฏแบบกำหนดผลได้
2. เขียนจุดยึดความสม่ำเสมอ สถานะแสง และพรอมต์แผ่นอ้างอิงของแต่ละฉากและอุปกรณ์
3. ใช้ `validate --cast cast.json` ไล่ตรวจพรอมต์กับรายชื่อตัวละครจนผ่านทุกด่าน
4. ใช้ `render --lang th` ออกรายงานภาษาไทย

คำสั่งหลัก:

```bash
node scripts/novel-art.mjs seed outline.json > art.json
node scripts/novel-art.mjs validate art.json --cast cast.json
node scripts/novel-art.mjs checkup art.json
node scripts/novel-art.mjs render art.json --html --lang th > art-report.html
node scripts/selftest.mjs
```

ตัวอย่าง `examples/渡口-art.json` ใช้ทดสอบรายงานสามภาษาและด่านคุณภาพโดยไม่เรียกโมเดล
