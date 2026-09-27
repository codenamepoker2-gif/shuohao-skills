[![中文](https://img.shields.io/badge/中文-f2e3e3?style=for-the-badge&labelColor=f2e3e3&color=b07070)](README.md)
[![English](https://img.shields.io/badge/English-f2e3e3?style=for-the-badge&labelColor=f2e3e3&color=b07070)](README.en.md)
[![ไทย](https://img.shields.io/badge/ไทย-8b1a1a?style=for-the-badge)](README.th.md)

# novel-storyboard

ทำสตอรีบอร์ดละครสั้นสำหรับผลิตด้วย AI: เปลี่ยนลำดับจังหวะจาก novel-script ให้เป็นใบสั่งงานที่ส่งตรงเข้าโมเดลวิดีโอได้ โครงสร้างสามชั้นคือ **ช่วงภาพ (segment) → ช็อต (cut) → ภาพหลัก (frame)** — หนึ่งช่วงภาพเท่ากับการเรียกสร้างวิดีโอหนึ่งครั้ง (ไม่เกิน 15 วินาที ไม่ข้ามฉาก) ภายในหนึ่งช่วงมีช็อต 3–5 ช็อต ยาว 2–5 วินาทีต่อช็อต และแต่ละช็อตมีภาพหลักปักไว้ที่ตำแหน่งเวลาของตัวเอง พร้อมพรอมต์ H3 หนึ่งชุดต่อช่วงที่คำสั่งจัดแนวภาพและเวลาตัดเป็นข้อความที่ตรวจทานคำต่อคำได้

ผลลัพธ์คือ `storyboard.json` รายการช็อตแบบ Markdown และ `storyboard-report.html` แบบไฟล์เดียว

## ภาษา

- `lang` กำหนดภาษาของหน้ารายงาน: `zh`, `th`, `en` มีมาให้ในตัว ลำดับความสำคัญคือ `--lang` > ฟิลด์ `lang` ใน JSON > ค่าเริ่มต้น `zh`
- `contentLang` กำหนดภาษาของบท: ค่าเริ่มต้น `zh` รองรับ `th` และ `en` — ใช้กับการนับความยาวบทพูดและการคำนวณเวลาตัด
- เมื่อ `contentLang` เป็น `th` หรือ `en` ทุกช็อตต้องมี `shotPrompt` ภาษาอังกฤษสำหรับ Seedance และ `frame` ต้องเป็นภาษาอังกฤษสำหรับสร้างภาพ ส่วน `shot` เป็นคำบรรยายภาษาของเรื่อง ช่องจัดองค์ประกอบ (เช่น `blocking`, `lens`, `cameraPosition`) เขียนด้วยภาษาของเรื่องและเติมช่อง `*Prompt` ภาษาอังกฤษคู่กันทุกช่อง ตัวส่งออกจะเติมบทพูดต้นฉบับในเครื่องหมายบทพูดให้เอง ดูรายละเอียดใน `references/schema.md` และ `references/seedance-prompt.md`
- ภาษาพรอมต์ H3 ควบคุมด้วย `promptLang` แยกต่างหาก (ค่าเริ่มต้นอังกฤษ) ไม่ผูกกับภาษาหน้ารายงาน
- การเปลี่ยนภาษาหน้ารายงานไม่แปลบทพูดให้เอง

ตัวอย่างการใช้งาน:

```bash
node scripts/novel-storyboard.mjs render examples/渡口-storyboard.json --html --script ../novel-script/examples/渡口-script.json --lang th > /tmp/storyboard-th.html
node scripts/novel-storyboard.mjs render examples/渡口-storyboard.json --html --script ../novel-script/examples/渡口-script.json --lang en > /tmp/storyboard-en.html
```

## ด่านคุณภาพเป็นโค้ด

ด่านคุณภาพทั้ง 18 ด่านตรวจแบบกำหนดผลได้ใน `validate`: การครอบคลุมทุกจังหวะของบท ความยาวช่วงภาพและช็อต ความยาวบทพูดที่ต้องลงตัวกับความยาวช็อต รูปแบบรหัสช่วงภาพ คำขนาดภาพ คำศัพท์กล้อง โครงสร้าง H3 และบทพูดในพรอมต์ H3 ต้องตรงคำต่อคำ ความสม่ำเสมอของภาษาพรอมต์ และการอ้างอิงฉาก ตัวละคร และอุปกรณ์

ทุกครั้งที่รัน `validate` และ `checkup` ผลของแต่ละด่านจะถูกบันทึกลง `.gates.jsonl` ในโฟลเดอร์ปัจจุบัน รันได้นานเท่าไรแล้วใช้ `stats` ดูว่าโมเดลละเมิดกฎใดบ่อยที่สุด — ข้อความที่ใช้บอกกฎคือสิ่งที่ต้องแก้ ไม่ใช่ตัวโมเดล

## ขั้นตอนทำงาน

1. ใช้ `seed <script.json> --eps 1` ขยายรายการจังหวะของแต่ละฉากเป็นใบงานตัดช็อตแบบกำหนดผลได้
2. ตัดช็อต เขียนคำบรรยายภาพ และเขียนพรอมต์ H3 ของแต่ละช่วง
3. ใช้ `validate --script` (บังคับ) และ `--outline` / `--cast` / `--art` ตามสิ่งที่มี จนผ่านทุกด่าน
4. ใช้ `render --lang th` ออกรายงานภาษาไทย และ `export` แพ็กชุดข้อมูลสำหรับสร้างวิดีโอ

คำสั่งหลัก:

```bash
node scripts/novel-storyboard.mjs seed script.json --eps 1
node scripts/novel-storyboard.mjs validate sb.json --script script.json
node scripts/novel-storyboard.mjs checkup sb.json --script script.json
node scripts/novel-storyboard.mjs render sb.json --html --script script.json --lang th > storyboard-report.html
node scripts/novel-storyboard.mjs export sb.json --script script.json
node scripts/selftest.mjs
```

ตัวอย่าง `examples/渡口-storyboard.json` คือสตอรีบอร์ดตอนที่ 1 ฉบับเต็ม (10 ช่วง 34 ช็อต ครอบคลุม 35 จังหวะ) ใช้ทดสอบรายงานสามภาษาและด่านคุณภาพโดยไม่เรียกโมเดล
