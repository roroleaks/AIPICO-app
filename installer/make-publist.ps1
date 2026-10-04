# Generate Word document: Dr Raouf Roshdy - Complete Publication List
$ErrorActionPreference = "Stop"

$items = @(
  # --- SECTION 1: Peer-reviewed journal articles ---
  @{S=1; T="Expert consensus on the role of supplementation in obstetrics and gynecology using modified Delphi method"; A="Multidisciplinary expert panel (incl. Raouf Roshdy)"; V="Archives of Gynecology and Obstetrics (Springer)"; Y="2023"; L=@(@("DOI: 10.1007/s00404-023-07310-3","https://doi.org/10.1007/s00404-023-07310-3"))}
  @{S=1; T="Medicine in Ancient Egypt: A Comprehensive Study"; A="Raouf Roshdy"; V="Aswan Africa Obstetrics and Gynecology Journal, 2025;1(2):1-9"; Y="2025"; L=@(@("DOI: 10.21608/aaogj.2025.388929.1013","https://doi.org/10.21608/aaogj.2025.388929.1013"),@("Journal full text","https://aaogj.journals.ekb.eg/article_431003.html"),@("ResearchGate","https://www.researchgate.net/publication/392319288_Medicine_in_Ancient_Egypt_A_Comprehensive_Study"))}
  @{S=1; T="Confronting the Structural Crisis in Maternal Healthcare: A Global Commentary on Obstetric Violence and Path to Reform"; A="Dr Raouf Roshdy"; V="Aswan Africa Obstetrics and Gynecology Journal"; Y="2026"; L=@(@("DOI: 10.21608/aaogj.2026.508519.1041","https://doi.org/10.21608/aaogj.2026.508519.1041"),@("Figshare deposit: 10.6084/m9.figshare.33115868","https://doi.org/10.6084/m9.figshare.33115868"))}
  @{S=1; T="Synergistic Potential of Nutraceuticals in Female Sexual Dysfunction: A Mechanistic Rationale and Proposed Translational Research Program"; A="Raouf Roshdy"; V="Archives of Gynaecology and Women Health (ISSN 2836-497X)"; Y="2026"; L=@(@("DOI: 10.58489/2836-497x/035","https://doi.org/10.58489/2836-497x/035"),@("Earlier presentation version (ResearchGate)","https://www.researchgate.net/publication/393646182_nutricutical_in_FSD"))}
  @{S=1; T="Rectal Ultrasound (TRU) in Embryo Transfer (ET) for ICSI in Specific Populations"; A="Raouf Roshdy et al."; V="Aswan Africa Obstetrics and Gynecology Journal"; Y="2025"; L=@(@("Journal full text","https://aaogj.journals.ekb.eg/article_456818.html"))}
  @{S=1; T="Primary Cutaneous Endometriosis of the Right Breast Skin Presenting with Cyclical Pain and Bleeding with Concurrent Vitiligo: A Rare Case Report"; A="Raouf Roshdy (co-author)"; V="Aswan Africa Obstetrics and Gynecology Journal"; Y="2026"; L=@(@("Journal full text","https://aaogj.journals.ekb.eg/article_516312.html"),@("ResearchGate","https://www.researchgate.net/publication/409209768_Primary_Cutaneous_Endometriosis_of_the_Right_Breast_Skin_Presenting_with_Cyclical_Pain_and_Bleeding_with_Concurrent_Vitiligo_A_Rare_Case_Report"))}
  @{S=1; T="Leveraging Generative AI and Large Language Models for Medical Education and Evidence-Based Medicine"; A="Raouf Roshdy et al."; V="Evidence Based Women's Health Journal"; Y="2026"; L=@(@("Journal article (PDF)","https://ebwhj.journals.ekb.eg/article_510536.html"))}

  # --- SECTION 2: Preprints and research reports ---
  @{S=2; T="Artificial Intelligence in Healthcare: A Systematic Review of the Evidence on Patient Outcomes, Diagnostic Accuracy, and Safety Outcomes Across Clinical Domains, 2023-2026"; A="Raouf Roshdy; Haitham Badran (Fayoum University)"; V="Preprint (ResearchGate)"; Y="2026"; L=@(@("DOI: 10.13140/RG.2.2.27040.34565","https://doi.org/10.13140/RG.2.2.27040.34565"))}
  @{S=2; T="The Role of Artificial Intelligence in Infertility Management: A Systematic Review of Current Applications and Future Directions"; A="Raouf Roshdy"; V="Preprint (ResearchGate)"; Y="2026"; L=@(@("ResearchGate","https://www.researchgate.net/publication/400442098_The_Role_of_Artificial_Intelligence_in_Infertility_Management_A_Systematic_Review_of_Current_Applications_and_Future_Directions"))}
  @{S=2; T="The Inflection Point: Navigating the AI Revolution in Urogynecology - A Narrative Review"; A="Raouf Roshdy; Osama Warda; Ahmed Badawy"; V="Preprint + poster (ResearchGate)"; Y="2026"; L=@(@("Preprint (ResearchGate)","https://www.researchgate.net/publication/404945556_The_Inflection_Point_Navigating_the_AI_Revolution_in_Urogynecology_A_Narrative_Review"),@("Poster version","https://www.researchgate.net/publication/404945656_The_Inflection_Point_Navigating_the_AI_Revolution_in_Urogynecology_A_Narrative_Review"))}
  @{S=2; T="Why Every Gynecologist Needs to Understand Artificial Intelligence Today"; A="Raouf Roshdy; Abou Bakr Elnashar"; V="Preprint (ResearchGate)"; Y="2026"; L=@(@("ResearchGate","https://www.researchgate.net/publication/404511297_Why_Every_Gynecologist_Needs_to_Understand_Artificial_Intelligence_Today"))}
  @{S=2; T="The Economic and Clinical Impact of Emerging Artificial Intelligence in Intracytoplasmic Sperm Injection (ICSI) Procedures within Developing Nations"; A="Raouf Roshdy et al."; V="Preprint (ResearchGate)"; Y="2026"; L=@(@("ResearchGate","https://www.researchgate.net/publication/404946535_The_Economic_and_Clinical_Impact_of_Emerging_Artificial_Intelligence_in_Intracytoplasmic_Sperm_Injection_ICSI_Procedures_within_Developing_Nations"))}
  @{S=2; T="Hallucinated Citations in Academic Writing: Risks, Mechanisms, and Strategies for Prevention"; A="Raouf Roshdy"; V="Preprint (ResearchGate)"; Y="2026"; L=@(@("ResearchGate","https://www.researchgate.net/publication/403522231_Title_Hallucinated_Citations_in_Academic_Writing_Risks_Mechanisms_and_Strategies_for_Prevention_Author"))}
  @{S=2; T="Navigating the Midlife Intimate Shift: A Biopsychosocial Framework for Reclaiming Desire and Connection After Fifty"; A="Raouf Roshdy; Doaa Saleh"; V="Research report (ResearchGate)"; Y="2026"; L=@(@("DOI: 10.13140/RG.2.2.16378.86728","https://doi.org/10.13140/RG.2.2.16378.86728"))}
  @{S=2; T="Evaluating whether cryopreservation-thawing followed by post-thaw sperm selection improves ICSI outcomes compared to fresh sperm protocols"; A="Raouf Roshdy"; V="Preprint (ResearchGate)"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/399189872_Evaluating_whether_cryopreservation-thawing_followed_by_post-thaw_sperm_selection_improves_ICSI_outcomes_compared_to_fresh_sperm_protocols"))}
  @{S=2; T="The use of AI to achieve security and safety for minors and females in app-dependent ride-hailing in Egypt"; A="Marianne A. Azer; Raouf Roshdy"; V="Preprint (ResearchGate)"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/398729178_The_use_of_AI_to_achieve_security_safety_for_minors_and_females_in_app-dependent_ride-hailing_in_Egypt"))}
  @{S=2; T="The AI Revolution in Medicine: Navigating the Frontier of Sexual Reproductive Health"; A="Raouf Roshdy"; V="Preprint (ResearchGate)"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/398772872_The_AI_Revolution_in_Medicine_Navigating_the_Frontier_of_Sexual_Reproductive_Health"))}
  @{S=2; T="AI Predictive Models in In Vitro Fertilization: A Critical Appraisal of Clinical Efficacy and Cost-Effectiveness"; A="Raouf Roshdy"; V="Research report (ResearchGate)"; Y="2025"; L=@(@("DOI: 10.13140/RG.2.2.17184.44809","https://doi.org/10.13140/RG.2.2.17184.44809"))}
  @{S=2; T="Common Misconceptions and Myths about Artificial Intelligence"; A="Raouf Roshdy; Hesham Al-Inany"; V="Preprint (ResearchGate)"; Y="2025"; L=@(@("DOI: 10.13140/RG.2.2.19240.48648","https://doi.org/10.13140/RG.2.2.19240.48648"))}
  @{S=2; T="Staying Updated on New AI Models, Tools, Agents, News, and Advances Relevant to Medical Practice"; A="Raouf Roshdy; Hesham Al-Inany; Dalia Ayman; Nevine Makram Labib et al."; V="Preprint (ResearchGate)"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/394631356_Staying_Updated_on_New_AI_Models_Tools_Agents_News_and_Advances_Relevant_to_Medical_Practice"))}
  @{S=2; T="GPT-5 in Medical Diagnostics: Reducing Errors Through Advanced AI Prompting - An evidence-based guide for medical professionals and students"; A="Raouf Roshdy et al."; V="Preprint (ResearchGate)"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/394432035_GPT-5_in_Medical_Diagnostics_Reducing_Errors_Through_Advanced_AI_Prompting_An_evidence-based_guide_for_medical_professionals_and_students_on_leveraging_GPT-5_for_improved_diagnostic_accuracy_and_patie"))}
  @{S=2; T="First Academic AI Trial for Papyrus Restoration"; A="Raouf Roshdy"; V="Preprint (ResearchGate)"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/394341818_First_academic_Ai_Trial_for_Papyrus_Restoration"))}
  @{S=2; T="AI-Powered Logical Reconstruction of Ancient Papyri: A Case Study on the Ipuwer Papyrus"; A="Raouf Roshdy"; V="Preprint (ResearchGate)"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/394118285_AI-Powered_Logical_Reconstruction_of_Ancient_Papyri_A_Case_Study_on_the_Ipuwer_Papyrus"))}
  @{S=2; T="AI-Driven Personalized Medicine: Advancements, Challenges, and Future Directions"; A="Raouf Roshdy"; V="Preprint (ResearchGate)"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/393601287_Title_AI-Driven_Personalized_Medicine_Advancements_Challenges_and_Future_Directions"))}

  # --- SECTION 3: Full-text articles and reviews on ResearchGate ---
  @{S=3; T="Comparative Analysis of Vaginal Tightening Techniques: IMRAD-Compliant Research Paper"; A="Raouf Roshdy; Rasha Belal"; V="Article (ResearchGate full text)"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/394845192_Comparative_Analysis_of_Vaginal_Tightening_Techniques_IMRAD-_Compliant_Research_Paper"))}
  @{S=3; T="Comparative Study of Kegel Exercise Devices: Efficacy, Usage Patterns, and Clinical Outcomes"; A="Raouf Roshdy; Doaa Saleh"; V="Article (ResearchGate full text)"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/393976999_Comparative_Study_of_Kegel_Exercise_Devices_Efficacy_Usage_Patterns_and_Clinical_Outcomes"))}
  @{S=3; T="The Day After Humanity: Artificial Intelligence and the Threshold of a New Consciousness"; A="Hossam Badrawi; Raouf Roshdy"; V="Article (ResearchGate full text)"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/395384430_The_Day_After_Humanity_Artificial_Intelligence_and_the_Threshold_of_a_New_Consciousness"))}

  # --- SECTION 4: Conference papers, presentations, posters ---
  @{S=4; T="Decoding the Machine: An Expanded Analytical Framework for Identifying Artificial Intelligence Authorship in Scientific Literature"; A="Raouf Roshdy"; V="Conference paper - LIBYA GYNE 2026"; Y="2026"; L=@(@("ResearchGate","https://www.researchgate.net/publication/410698783_Decoding_the_Machine_An_Expanded_Analytical_Framework_for_Identifying_Artificial_Intelligence_Authorship_in_Scientific_Literature"))}
  @{S=4; T="Probiotics in ICSI"; A="Raouf Roshdy"; V="Conference presentation"; Y="2026"; L=@(@("ResearchGate","https://www.researchgate.net/publication/405515307_Probiotics_in_ICSI"))}
  @{S=4; T="The Human Zinc Spark (zinc spark as a new quality measure for embryos)"; A="Raouf Roshdy"; V="Conference paper"; Y="2026"; L=@(@("ResearchGate","https://www.researchgate.net/publication/401963490_The_Human_Zinc_Spark"))}
  @{S=4; T="PM2.5 and Reproduction (effect of PM2.5 on ICSI outcome)"; A="Raouf Roshdy"; V="Conference presentation"; Y="2026"; L=@(@("ResearchGate","https://www.researchgate.net/publication/401963725_PM25_and_Reproduction"))}
  @{S=4; T="Recurrent Implantation Failure: A Comprehensive Evidence-Based Analysis"; A="Raouf Roshdy"; V="Conference paper"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/394878371_Recurrent_Implantation_Failure_A_Comprehensive_Evidence-Based_Analysis"))}
  @{S=4; T="Low Intensity Extracorporeal Shock Wave Therapy as a Novel Treatment for Stress Urinary Incontinence"; A="Raouf Roshdy"; V="Conference presentation"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/393936824_Low_Intensity_Extracorporeal_Shock_Wave_Therapy_as_a_Novel_Treatment_for_Stress_Urinary_Incontinence"))}
  @{S=4; T="D-Chiro-Myo Inositol Versus Metformin: Bioactive Compounds in Polycystic Ovary Syndrome Management - OHSS Prevention in ICSI Cycles"; A="Raouf Roshdy"; V="Conference presentation"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/393650324_D-Chiro-Myo_Inositol_Versus_Metformin"))}
  @{S=4; T="AI-Driven Pregnancy Monitoring: A Scientific Hypothesis for Future Evaluation"; A="Dalia Ayman; Raouf Roshdy"; V="Research proposal / conference"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/393661037_AI-Driven_Pregnancy_Monitoring_A_Scientific_Hypothesis_for_Future_Evaluation"))}
  @{S=4; T="Ganna Hospital Conference 2025 (co-ordinator)"; A="Raouf Roshdy"; V="Conference poster"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/393936550_Ganna_hospital_Conference"))}
  @{S=4; T="Workshop - Azhar University"; A="Raouf Roshdy; Dalia Ayman"; V="Conference paper / workshop material"; Y="2025"; L=@(@("ResearchGate","https://www.researchgate.net/publication/394422881_workshop_Azhar_University"))}

  # --- SECTION 5: Other publications ---
  @{S=5; T="The Second Arab-African Forum for AI Applications in the Health System (Arabic)"; A="Raouf Roshdy (per Google Scholar indexing)"; V="Egyptian Journal of Information Systems and Computer Technology, 34(34):49-51"; Y="2024"; L=@(@("Google Scholar profile","https://scholar.google.com/citations?user=oyjPJq8AAAAJ&hl=en"))}
)

$sections = @{
  1 = "Peer-Reviewed Journal Articles"
  2 = "Preprints and Research Reports (ResearchGate)"
  3 = "Full-Text Articles and Reviews"
  4 = "Conference Papers, Presentations and Posters"
  5 = "Other Publications"
}

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Add()

# Page setup A4
$doc.PageSetup.PaperSize = 7  # wdPaperA4
$doc.PageSetup.TopMargin = 56.7; $doc.PageSetup.BottomMargin = 56.7
$doc.PageSetup.LeftMargin = 70.9; $doc.PageSetup.RightMargin = 70.9

$end = $doc.Range(); $end.Collapse(0)  # wdCollapseEnd
$sel = $end

function Add-Text($text, $size, $bold, $color, $italic) {
  $script:sel.Collapse(0)
  $script:sel.Text = $text
  $script:sel.Font.Size = $size
  $script:sel.Font.Bold = if ($bold) {1} else {0}
  $script:sel.Font.Italic = if ($italic) {1} else {0}
  if ($color) { $script:sel.Font.Color = $color }
  $script:sel.Font.Name = "Calibri"
  $script:sel.InsertParagraphAfter()
  $script:sel.Collapse(0)
}

function Add-HL($label, $url) {
  $script:sel.Collapse(0)
  $script:sel.Text = $label
  $doc.Hyperlinks.Add($script:sel, $url, $false, $label, $label) | Out-Null
  $script:sel.Collapse(0)
}

# ===== Title block =====
Add-Text "Dr Raouf Roshdy" 26 $true 7876720 $false
Add-Text "MD, MRCOG - Complete Publication List" 14 $false 5526612 $false
Add-Text "Reproductive Health Consultant | Medical AI Researcher | Egypt Health Foundation" 10 $false 6710886 $true
Add-Text "Compiled August 2026 from ORCID (0009-0001-4841-1656), ResearchGate, Google Scholar and journal websites - deduplicated" 9 $false 6710886 $true
Add-Text "" 8 $false $null $false

# Profile links
Add-Text "Researcher profiles:  " 10 $true $null $false
Add-HL "ORCID 0009-0001-4841-1656" "https://orcid.org/0009-0001-4841-1656"
$sel.Text = "   |   "; $sel.Font.Size=10; $sel.Collapse(0)
Add-HL "Google Scholar" "https://scholar.google.com/citations?user=oyjPJq8AAAAJ"
$sel.Text = "   |   "; $sel.Font.Size=10; $sel.Collapse(0)
Add-HL "ResearchGate" "https://www.researchgate.net/profile/Raouf-Roshdy-2"
$sel.InsertParagraphAfter(); $sel.Collapse(0)
Add-Text "" 8 $false $null $false

# ===== Sections =====
$counter = 0
foreach ($secNum in 1..5) {
  Add-Text $sections[$secNum] 15 $true 7876720 $false
  $secItems = $items | Where-Object { $_.S -eq $secNum }
  foreach ($it in $secItems) {
    $counter++
    # Title
    Add-Text "$counter. $($it.T)" 11.5 $true 0 $false
    # Authors / venue / year
    Add-Text "$($it.A)  |  $($it.V)  |  $($it.Y)" 10 $false 6710886 $true
    # Links
    $sel.Collapse(0)
    $first = $true
    foreach ($lk in $it.L) {
      if (-not $first) { $sel.Text = "   |   "; $sel.Font.Size=9.5; $sel.Collapse(0) }
      Add-HL $lk[0] $lk[1]
      $first = $false
    }
    $sel.InsertParagraphAfter(); $sel.Collapse(0)
    Add-Text "" 6 $false $null $false
  }
  Add-Text "" 8 $false $null $false
}

# ===== Note =====
Add-Text "Notes on compilation" 12 $true 7876720 $false
Add-Text "1. Every entry above is deduplicated: multiple versions of the same work (preprint + journal version, article + poster) are listed once under the most complete record." 9.5 $false $null $false
Add-Text "2. Works signed 'Roshdy E' indexed in PubMed (medicinal chemistry: SIRT2/VEGFR-2 inhibitors, J Med Chem, Eur J Med Chem; and a geophysics paper in Sensors) belong to different researchers with the same surname and were excluded." 9.5 $false $null $false
Add-Text "3. '2D Sonographic-guided versus non-guided Copper T IUD insertion' (J Obstet Gynaecol Can 2026, DOI 10.1016/j.jogc.2026.103239) appears on Google Scholar in this profile, but the publisher's author list does not include Dr Roshdy; excluded pending verification." 9.5 $false $null $false
Add-Text "4. ResearchGate DOIs (10.13140/RG.2.2.x) identify preprint deposits; journal DOIs (10.1007, 10.21608, 10.58489, 10.6084) identify the published records." 9.5 $false $null $false

$outPath = "C:\Users\raouf.RAOUFDESKTOP\Documents\Dr_Raouf_Roshdy_Publications.docx"
if (Test-Path $outPath) { Remove-Item $outPath -Force }
$doc.SaveAs([ref]$outPath, [ref]16)  # wdFormatDocumentDefault
$doc.Close()
$word.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
Write-Output "SAVED: $outPath"
Get-Item $outPath | Select-Object Name, Length, LastWriteTime
