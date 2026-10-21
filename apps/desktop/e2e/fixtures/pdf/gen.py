import html
P1 = ("Depth determination is a fundamental task for a hydrographer, which requires specific knowledge of the "
      "techniques and equipment involved. According to the IHO publication S-44 5<sup>th</sup> Edition, the uncertainty "
      "of depth measurements shall be estimated at the 95% confidence level for every sounding in the survey.")
P2 = ("During the last decade, hydrographic surveying has experienced a conceptual change in depth measurement, "
      "moving from single-beam echo sounders to multibeam and LiDAR systems. The 2<sup>nd</sup> generation of "
      "swath systems delivers dense coverage of the seafloor with reduced survey time and improved accuracy.")
P3 = ("Lead line and sounding pole were the earliest methods used for directly measuring water depth. These "
      "methods are still applied in very shallow waters, where acoustic instruments cannot be operated safely, "
      "and they remain useful as an independent check of the echo sounder calibration.")
P4 = ("Tidal reduction is required to refer all observed depths to a common vertical datum, usually chart datum. "
      "Errors in the tidal model propagate directly into the reduced depths and must be included in the total "
      "propagated uncertainty of each sounding.")
ZH = ["测深是海道测量员的一项基本任务，需要掌握相关技术和设备的专门知识。根据国际海道测量组织出版物第五版的规定，每个测深点的深度测量不确定度应在百分之九十五置信水平下进行估算。",
      "在过去十年中，海道测量在深度测量方面经历了概念上的转变，从单波束回声测深仪转向多波束和激光雷达系统。新一代条带系统能够以更短的测量时间和更高的精度实现海底的密集覆盖。",
      "测深铅锤和测深杆是最早用于直接测量水深的方法。这些方法至今仍应用于声学仪器无法安全作业的极浅水域。"]
def fodt(name, paras, font, cols=1, lang="en", country="US", heading="4.1 Depth determination"):
    body = "".join(f'<text:p text:style-name="Body">{p.replace("<sup>","<text:span text:style-name=\"Sup\">").replace("</sup>","</text:span>")}</text:p>' for p in paras)
    xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.text">
<office:font-face-decls><style:font-face style:name="F" svg:font-family="'{font}'" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"/></office:font-face-decls>
<office:styles>
<style:style style:name="Body" style:family="paragraph"><style:paragraph-properties fo:text-align="justify" fo:margin-bottom="0.25cm"/><style:text-properties style:font-name="F" style:font-name-asian="F" fo:font-size="11pt" style:font-size-asian="11pt" fo:language="{lang}" fo:country="{country}" style:language-asian="{lang}" style:country-asian="{country}"/></style:style>
<style:style style:name="H" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.3cm"/><style:text-properties style:font-name="F" style:font-name-asian="F" fo:font-size="15pt" style:font-size-asian="15pt" fo:font-weight="bold" style:font-weight-asian="bold"/></style:style>
<style:style style:name="Sup" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>
</office:styles>
<office:automatic-styles><style:page-layout style:name="PL"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin="2.5cm"><style:columns fo:column-count="{cols}" fo:column-gap="0.8cm"/></style:page-layout-properties></style:page-layout></office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="PL"/></office:master-styles>
<office:body><office:text><text:p text:style-name="H">{heading}</text:p>{body}</office:text></office:body></office:document>'''
    open(name + ".fodt", "w").write(xml)
fodt("hydro-serif", [P1, P2, P3, P4], "Nimbus Roman")
fodt("hydro-zh", ZH, "Noto Serif CJK SC", lang="zh", country="CN", heading="4.1 深度测定")
fodt("hydro-2col", [P1, P2, P3, P4, P1, P2], "Nimbus Roman", cols=2)
