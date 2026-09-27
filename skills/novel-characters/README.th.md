[![中文](https://img.shields.io/badge/中文-f2e3e3?style=for-the-badge&labelColor=f2e3e3&color=b07070)](README.md)
[![English](https://img.shields.io/badge/English-f2e3e3?style=for-the-badge&labelColor=f2e3e3&color=b07070)](README.en.md)
[![ไทย](https://img.shields.io/badge/ไทย-8b1a1a?style=for-the-badge)](README.th.md)

# novel-characters

แปลงนิยายหรือเรื่องสั้นเป็นชุดข้อมูลตัวละครที่พร้อมใช้งานต่อ ได้แก่ รายชื่อตัวละคร ประวัติ หลักฐานคำต่อคำจากต้นฉบับ ความสัมพันธ์ พรอมต์ภาพ พรอมต์เสียง และคำสั่งสำหรับสร้างแผ่นแบบตัวละคร 16:9 ตัว skill ไม่สร้างภาพ แต่ส่งมอบพรอมต์ภาษาอังกฤษสำหรับระบบสร้างภาพและ TTS

ผลลัพธ์ประกอบด้วย `cast.json`, Markdown และ `report.html` แบบไฟล์เดียวที่เปิดใช้งานแบบออฟไลน์ได้

## ภาษา

- `lang` กำหนดภาษาของหน้ารายงาน: `zh`, `th`, `en`, `ja` มีมาให้ในตัว
- `contentLang` กำหนดภาษาของเนื้อหาตัวละคร: ค่าเริ่มต้นคือ `zh` และรองรับ `th` กับ `en`
- พรอมต์ภาพและพรอมต์ TTS ต้องเป็นภาษาอังกฤษเสมอ
- หลักฐานจากต้นฉบับคงข้อความเดิมเพื่อให้ตรวจแบบคำต่อคำได้
- การวัดความยาวภาษาไทยไม่นับสระและวรรณยุกต์แบบ combining

ตัวอย่างภาษาไทย:

```bash
node scripts/novel-characters.mjs validate examples/สะพาน-cast.json examples/สะพาน.txt
node scripts/novel-characters.mjs render examples/สะพาน-cast.json --html --lang th > /tmp/สะพาน-report.html
node scripts/novel-characters.mjs render examples/สะพาน-cast.json --html --lang en > /tmp/bridge-report.html
```

## ขั้นตอนทำงาน

1. ใช้ `seed` กับ `outline.json` หากมี เพื่อคงรายชื่อตัวละคร รหัส ระดับ และเส้นเรื่องจากขั้น outline
2. ใช้ `chunk` แบ่งต้นฉบับเป็นช่วงที่ซ้อนกัน แล้วสแกนชื่อ ชื่อเรียก คำบรรยาย และหลักฐาน
3. ใช้ `merge` รวมชื่อเรียกของคนเดียวกัน และตรวจ `mergeCandidates`
4. สร้างการ์ดตัวละครแต่ละคน โดยให้ข้อความสำหรับมนุษย์ตรงกับ `contentLang` และพรอมต์เครื่องเป็นภาษาอังกฤษ
5. ใช้ `assemble --lang th --content-lang th` เพื่อสร้าง `cast.json`
6. ใช้ `validate` จนผ่าน แล้วจึงใช้ `render`

กฎสำคัญของตัวตรวจคือ หลักฐานต้องเป็นข้อความต่อเนื่องจากต้นฉบับ พรอมต์ภาพห้ามมีชื่อตัวละคร และช่องที่ส่งให้โมเดลภาพหรือ TTS ต้องเป็นภาษาอังกฤษ

## คำสั่ง

```bash
node scripts/novel-characters.mjs seed outline.json
node scripts/novel-characters.mjs chunk book.txt /tmp/work
node scripts/novel-characters.mjs merge /tmp/work
node scripts/novel-characters.mjs assemble /tmp/work --source ชื่อเรื่อง --lang th --content-lang th --out cast.json
node scripts/novel-characters.mjs validate cast.json book.txt
node scripts/novel-characters.mjs render cast.json --html > report.html
node scripts/selftest.mjs
```

ไฟล์ตัวอย่าง `examples/สะพาน.txt` และ `examples/สะพาน-cast.json` ใช้ทดสอบเนื้อหาและหน้ารายงานภาษาไทยโดยไม่เรียกโมเดล
