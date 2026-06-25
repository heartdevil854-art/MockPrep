// =============================================
// SUPABASE CONNECTION
// =============================================
const SUPABASE_URL = 'https://waftghfabhpztkyrbzzp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndhZnRnaGZhYmhwenRreXJienpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4ODQzMzIsImV4cCI6MjA5NzQ2MDMzMn0.k-94kVewD_v-4d1nuKC-_UryGAvL62WibTctt3ltVKQ';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
    }
});

let currentCaptcha = '';
let isLoginMode = true;

// --- GLOBAL TEST DATA ---
let currentTest = null; // Will hold Screen 1 data + questions
let currentSubject = null; // Currently selected subject
let currentQuestionIndex = 1; // Tracks question number within subject
const MAX_IMAGE_SIZE = 1048576; // 1MB in bytes
let activeTest = null;
let activeQuestions = []; // Flattened list of questions for current test
let candidateCurrentQuestionIndex = 0;
let userAnswers = {}; // { questionId: selectedOptionIndex }
let visitedQuestions = new Set();
let markedForReview = new Set();
let testTimer = null;
let timeRemaining = 0;
let selectedOptionalSubject = null;
let currentSubjectInTest = null;
let isSectionalTest = false;
let sectionalTimers = [];
let currentSectionIndex = 0;
let sectionTimeRemaining = 0;
// =============================================
// TAB SWITCHING
// =============================================
function switchTab(mode) {
    isLoginMode = (mode === 'login');
    document.getElementById('tab-login').classList.toggle('active', isLoginMode);
    document.getElementById('tab-signup').classList.toggle('active', !isLoginMode);
    document.getElementById('input-name').classList.toggle('hidden', isLoginMode);
    document.getElementById('forgot-password').classList.toggle('hidden', !isLoginMode);
    document.getElementById('submit-btn').innerText = isLoginMode ? 'Login to MockPrep' : 'Create Account';
}

// =============================================
// CAPTCHA
// =============================================
function generateCaptcha() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    currentCaptcha = '';
    for (let i = 0; i < 4; i++) {
        currentCaptcha += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const display = document.getElementById('captcha-display');
    const noiseLines = display.querySelector('.absolute.inset-0');
    display.innerHTML = '';
    display.appendChild(noiseLines);
    currentCaptcha.split('').forEach(function(char) {
        const span = document.createElement('span');
        span.innerText = char;
        span.className = 'captcha-char relative z-10';
        span.style.transform = 'rotate(' + (Math.random() * 30 - 15) + 'deg)';
        span.style.color = 'hsl(' + Math.floor(Math.random() * 360) + ', 80%, 70%)';
        display.appendChild(span);
    });
    document.getElementById('input-captcha').value = '';
    document.getElementById('captcha-error').classList.add('hidden');
}

// =============================================
// AUTH HANDLER// =============================================
async function handleAuth(event) {
    event.preventDefault();
    const userInput = document.getElementById('input-captcha').value.toUpperCase();
    if (userInput !== currentCaptcha) {
        document.getElementById('captcha-error').classList.remove('hidden');
        generateCaptcha();
        return;
    }
    document.getElementById('captcha-error').classList.add('hidden');

    const email = document.getElementById('input-email').value;
    const password = document.getElementById('input-password').value;
    const name = document.getElementById('input-name').value;
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.innerText = 'Processing...';
    submitBtn.disabled = true;

    try {
        if (isLoginMode) {
            // --- LOGIN ---
            const { data, error } = await db.auth.signInWithPassword({
                email: email,
                password: password
            });
            if (error) throw error;

            // Fetch profile
            const { data: profile, error: profileError } = await db
                .from('profiles')
                .select('role, full_name')
                .eq('id', data.user.id)
                .single();

            if (profileError) throw profileError;

            alert('DEBUG: Role=' + profile.role + ', Name=' + profile.full_name);
            showDashboard(profile.role, profile.full_name);

        } else {
            // --- SIGNUP ---
            const { data, error } = await db.auth.signUp({
                email: email,
                password: password,
                options: { data: { full_name: name } }
            });
            if (error) throw error;
            alert('Account Created! Please login.');
            switchTab('login');
            document.getElementById('input-email').value = email;        }
    } catch (error) {
        alert('Error: ' + (error.message || JSON.stringify(error)));
    } finally {
        submitBtn.innerText = isLoginMode ? 'Login to MockPrep' : 'Create Account';
        submitBtn.disabled = false;
        generateCaptcha();
    }
}

// =============================================
// DASHBOARD ROUTING
// =============================================
function showDashboard(role, userName) {
    document.getElementById('auth-container').classList.add('hidden');
    
    if (role === 'admin') {
        document.getElementById('admin-dashboard').classList.remove('hidden');
        document.getElementById('admin-bottom-nav').classList.remove('hidden');
        document.getElementById('admin-name').innerText = userName || 'Admin';
        loadAdminProfileData();
    } else {
        document.getElementById('candidate-dashboard').classList.remove('hidden');
        document.getElementById('candidate-bottom-nav').classList.remove('hidden');
        document.getElementById('candidate-name').innerText = userName || 'Candidate';
        // Load candidate's tests
        loadCandidateTests();
    }
}

// =============================================
// LOGOUT
// =============================================
async function logout() {
    await db.auth.signOut();
    document.getElementById('admin-dashboard').classList.add('hidden');
    document.getElementById('admin-bottom-nav').classList.add('hidden');
    document.getElementById('admin-create-test-screen1').classList.add('hidden');
    document.getElementById('admin-create-test-screen2').classList.add('hidden');
    document.getElementById('candidate-dashboard').classList.add('hidden');
    document.getElementById('candidate-bottom-nav').classList.add('hidden');
    document.getElementById('candidate-free-mock-list').classList.add('hidden');
    document.getElementById('auth-container').classList.remove('hidden');
    document.getElementById('input-email').value = '';
    document.getElementById('input-password').value = '';
    generateCaptcha();
}

// =============================================
// FORGOT PASSWORD
// =============================================
async function handleForgotPassword() {
    const email = document.getElementById('input-email').value;
    if (!email) {
        alert('Please enter your email address first.');
        return;
    }
    const { error } = await db.auth.resetPasswordForEmail(email);
    if (error) {
        alert('Error: ' + error.message);
    } else {        alert('Password reset link sent to ' + email);
    }
}

// --- ADMIN BOTTOM NAV SWITCHING ---
function switchAdminTab(tabName, clickedElement) {
    // Remove active class from all nav items
    const navItems = document.querySelectorAll('#admin-bottom-nav .nav-item');
    navItems.forEach(item => {
        item.classList.remove('active');
        item.classList.add('text-pink-100/70');
    });
    
    // Add active class to the clicked item
    clickedElement.classList.add('active');
    clickedElement.classList.remove('text-pink-100/70');
    
    // Placeholder for next steps
    if(tabName !== 'home') {
        alert(`🚧 The ${tabName.charAt(0).toUpperCase() + tabName.slice(1)} Panel will be built in the next step!`);
    }
}

// --- NAVIGATION TO CREATE TEST ---
function showCreateTestScreen1() {
    // Hide home screen and bottom nav
    document.getElementById('admin-dashboard').classList.add('hidden');
    document.getElementById('admin-bottom-nav').classList.add('hidden');
    // Show Screen 1
    document.getElementById('admin-create-test-screen1').classList.remove('hidden');
}

function goBackToAdminHome() {
    alert('Function called!'); // Debug alert
    
    // Hide ALL admin screens
    const screens = [
        'admin-create-test-screen1',
        'admin-create-test-screen2',
        'admin-mini-mock-screen1',
        'admin-mini-mock-screen2',
        'admin-sectional-screen1',
        'admin-sectional-screen2',
        'admin-notification-screen',
        'admin-profile-screen'
    ];
    
    screens.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) {
            el.classList.add('hidden');
        }
    });
    
    // Show dashboard
    var dashboard = document.getElementById('admin-dashboard');
    var nav = document.getElementById('admin-bottom-nav');
    
    if (dashboard) dashboard.classList.remove('hidden');
    if (nav) nav.classList.remove('hidden');
    
    alert('Back to home complete!');
}

// --- SCREEN 1 FORM HANDLER ---
function handleScreen1Submit(event) {
    event.preventDefault();
    
    const subjectsRaw = document.getElementById('subjects').value.trim();
    if (!subjectsRaw) {
        alert('Please enter at least one subject.');
        return;
    }
    
    // Parse subjects (comma-separated)
    const subjects = subjectsRaw.split(',').map(s => s.trim()).filter(s => s.length > 0);
    
    currentTest = {
        title: document.getElementById('exam-title').value,
        totalQuestions: parseInt(document.getElementById('total-questions').value),
        maxMarks: parseFloat(document.getElementById('max-marks').value),
        duration: parseInt(document.getElementById('duration').value),
        rightMarks: parseFloat(document.getElementById('right-marks').value),
        negativeMarks: parseFloat(document.getElementById('negative-marks').value),
        subjects: subjects,
        optionalSubjects: document.getElementById('optional-subjects').value,
        questions: {} // Will store questions per subject
    };
    
    // Initialize empty array for each subject
    subjects.forEach(sub => {
        currentTest.questions[sub] = [];
    });
    
    // Clear form
    document.getElementById('form-screen1').reset();
    
    // Navigate to Screen 2
    showCreateTestScreen2();
}

// =============================================
// SCREEN 2 NAVIGATION
// =============================================
function showCreateTestScreen2() {
    document.getElementById('admin-create-test-screen1').classList.add('hidden');
    document.getElementById('admin-create-test-screen2').classList.remove('hidden');
    
    // Populate test info
    document.getElementById('screen2-test-title').innerText = currentTest.title;
    document.getElementById('screen2-q-total').innerText = currentTest.totalQuestions;
    updateQuestionCount();
    
    // Render subject tabs
    renderSubjectTabs();
    
    // Auto-select first subject
    if (currentTest.subjects.length > 0) {
        selectSubject(currentTest.subjects[0]);
    }
}

function goBackToScreen1() {
    const totalAdded = getTotalQuestionsCount();
    if (totalAdded > 0) {
        if (!confirm(`You have added ${totalAdded} question(s). Going back will keep them saved. Continue?`)) {
            return;
        }
    }
    document.getElementById('admin-create-test-screen2').classList.add('hidden');
    document.getElementById('admin-create-test-screen1').classList.remove('hidden');
}

// =============================================
// SUBJECT TABS
// =============================================
function renderSubjectTabs() {
    const container = document.getElementById('subject-tabs-container');
    container.innerHTML = '';
    currentTest.subjects.forEach((sub, index) => {
        const count = currentTest.questions[sub].length;
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'subject-tab';
        tab.setAttribute('data-subject', sub);
        tab.innerHTML = `${sub} <span class="text-xs opacity-70">(${count})</span>`;
        // Use addEventListener instead of onclick for better reliability
        tab.addEventListener('click', function() {
            selectSubject(sub);
        });
        container.appendChild(tab);
    });
}

function selectSubject(subject) {    currentSubject = subject;
    // Save current question draft first? For simplicity, we clear inputs when switching
    clearQuestionForm();
    
    // Update active tab styling
    document.querySelectorAll('.subject-tab').forEach(tab => {
        if (tab.getAttribute('data-subject') === subject) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    
    // Set question number to next in sequence for this subject
    currentQuestionIndex = currentTest.questions[subject].length + 1;
    document.getElementById('current-q-number').innerText = '#' + currentQuestionIndex;
}

// =============================================
// IMAGE UPLOAD HANDLER
// =============================================
function handleImageUpload(event, targetId) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Check size (1MB limit)
    if (file.size > MAX_IMAGE_SIZE) {
        alert(`❌ Image too large!\n\nFile size: ${(file.size / 1048576).toFixed(2)} MB\nLimit: 1 MB\n\nPlease choose a smaller image.`);
        event.target.value = ''; // Clear input
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const previewContainer = document.getElementById(targetId + '-preview');
        previewContainer.innerHTML = `
            <div class="image-preview">
                <img src="${e.target.result}" alt="preview">
                <div class="remove-img" onclick="removeImage('${targetId}')">✕</div>
            </div>
        `;
        // Store base64 data in a data attribute for later retrieval
        previewContainer.setAttribute('data-image', e.target.result);
    };
    reader.readAsDataURL(file);
}

function removeImage(targetId) {
    const previewContainer = document.getElementById(targetId + '-preview');
    if (previewContainer) {
        previewContainer.innerHTML = '';
        previewContainer.removeAttribute('data-image');
    }
    
    // Find and reset the corresponding file input
    const fileInputs = document.querySelectorAll('input[type="file"]');
    fileInputs.forEach(input => {
        const onchangeAttr = input.getAttribute('onchange');
        if (onchangeAttr && onchangeAttr.includes(`'${targetId}'`)) {
            input.value = '';
        }
    });
}

// =============================================
// SAVE QUESTION
// =============================================
function saveCurrentQuestion() {
    const questionText = document.getElementById('question-text').value.trim();
    const questionImage = document.getElementById('question-image-preview').getAttribute('data-image') || null;
    
    if (!questionText && !questionImage) {
        alert('⚠️ Please enter either question text or upload an image.');
        return;
    }
    
    // Gather options
    const options = [];
    for (let i = 0; i < 4; i++) {
        const optText = document.getElementById('option-' + i).value.trim();
        const optImage = document.getElementById('option-' + i + '-image-preview').getAttribute('data-image') || null;
        if (!optText && !optImage) {
            alert(`⚠️ Option ${String.fromCharCode(65 + i)} is empty. Please fill all options.`);
            return;
        }
        options.push({ text: optText, image: optImage });
    }
    
    // Get correct answer
    const correctOption = parseInt(document.querySelector('input[name="correct-option"]:checked').value);
    
    // Build question object
    const question = {
        id: currentQuestionIndex,
        text: questionText,
        image: questionImage,
        options: options,
        correct: correctOption
    };
    
    // Save to current subject
    currentTest.questions[currentSubject].push(question);
    
    // Update UI    renderSubjectTabs(); // Refresh tab counts
    // Re-apply active state
    document.querySelectorAll('.subject-tab').forEach(tab => {
        if (tab.getAttribute('data-subject') === currentSubject) {
            tab.classList.add('active');
        }
    });
    
    updateQuestionCount();
    clearQuestionForm();
    
    // Move to next question number
    currentQuestionIndex = currentTest.questions[currentSubject].length + 1;
    document.getElementById('current-q-number').innerText = '#' + currentQuestionIndex;
    
    // Show publish button if all questions added
    if (getTotalQuestionsCount() >= currentTest.totalQuestions) {
        document.getElementById('publish-test-btn').classList.remove('hidden');
        alert(`✅ All ${currentTest.totalQuestions} questions added!\n\nYou can now publish the test or add more for review.`);
    } else {
        alert(`✅ Question #${question.id} saved for "${currentSubject}"!\n\n${getTotalQuestionsCount()}/${currentTest.totalQuestions} questions added.`);
    }
}

function clearQuestionForm() {
    // Clear question text
    document.getElementById('question-text').value = '';
    
    // Clear all 4 options
    for (let i = 0; i < 4; i++) {
        const optionInput = document.getElementById('option-' + i);
        if (optionInput) {
            optionInput.value = '';
        }
        // Remove image preview safely
        const previewContainer = document.getElementById('option-' + i + '-image-preview');
        if (previewContainer) {
            previewContainer.innerHTML = '';
            previewContainer.removeAttribute('data-image');
        }
    }
    
    // Remove question image safely
    const questionPreview = document.getElementById('question-image-preview');
    if (questionPreview) {
        questionPreview.innerHTML = '';
        questionPreview.removeAttribute('data-image');
    }
    
    // Reset correct option to first option
    const firstOptionRadio = document.querySelector('input[name="correct-option"][value="0"]');
    if (firstOptionRadio) {
        firstOptionRadio.checked = true;
    }
    
    // Reset all file inputs
    const fileInputs = document.querySelectorAll('input[type="file"]');
    fileInputs.forEach(input => {
        input.value = '';
    });
}

// =============================================
// QUESTION COUNT HELPERS
// =============================================
function getTotalQuestionsCount() {
    let total = 0;
    for (const sub in currentTest.questions) {
        total += currentTest.questions[sub].length;
    }
    return total;
}

function updateQuestionCount() {
    document.getElementById('screen2-q-count').innerText = getTotalQuestionsCount();
}

// =============================================// SLIDE PANEL (Questions Overview)
// =============================================
function toggleSlidePanel() {
    const panel = document.getElementById('slide-panel');
    const overlay = document.getElementById('slide-panel-overlay');
    panel.classList.toggle('open');
    overlay.classList.toggle('open');
    
    if (panel.classList.contains('open')) {
        renderSlidePanelContent();
    }
}

function renderSlidePanelContent() {
    const container = document.getElementById('slide-panel-content');
    container.innerHTML = '';
    
    let hasAnyQuestions = false;
    
    currentTest.subjects.forEach(sub => {
        const questions = currentTest.questions[sub];
        const section = document.createElement('div');
        section.className = 'space-y-2';
        
        let header = `<div class="flex justify-between items-center pb-2 border-b border-white/10">
            <h4 class="text-white font-semibold">${sub}</h4>
            <span class="text-xs text-pink-200">${questions.length} Q</span>
        </div>`;
        
        let chips = '<div class="flex flex-wrap">';
        if (questions.length === 0) {
            chips += '<p class="text-white/50 text-xs italic">No questions yet</p>';
        } else {
            hasAnyQuestions = true;
            questions.forEach((q, idx) => {
                chips += `<span class="question-chip" onclick="loadQuestionFromPanel('${sub}', ${idx})">Q${idx + 1}</span>`;
            });
        }
        chips += '</div>';
        
        section.innerHTML = header + chips;
        container.appendChild(section);
    });
    
    if (!hasAnyQuestions) {
        container.innerHTML += '<p class="text-center text-white/60 text-sm mt-6">Start adding questions to see them here!</p>';
    }
}

function loadQuestionFromPanel(subject, index) {
    // First, ensure the subject tab is selected
    currentSubject = subject;
    
    // Update active tab styling
    document.querySelectorAll('.subject-tab').forEach(tab => {
        if (tab.getAttribute('data-subject') === subject) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    
    // Clear the form first
    clearQuestionForm();
    
    // Load the question data into the form
    const q = currentTest.questions[subject][index];
    if (!q) {
        alert('Question not found!');
        return;
    }
    
    // Load question text
    document.getElementById('question-text').value = q.text || '';
    
    // Load question image
    if (q.image) {
        const preview = document.getElementById('question-image-preview');
        preview.innerHTML = `<div class="image-preview"><img src="${q.image}" alt="preview"><div class="remove-img" onclick="removeImage('question-image')">✕</div></div>`;
        preview.setAttribute('data-image', q.image);
    }
    
    // Load all 4 options
    for (let i = 0; i < 4; i++) {
        const optionInput = document.getElementById('option-' + i);
        if (optionInput && q.options[i]) {
            optionInput.value = q.options[i].text || '';
        }
        
        // Load option image
        if (q.options[i] && q.options[i].image) {
            const preview = document.getElementById('option-' + i + '-image-preview');
            preview.innerHTML = `<div class="image-preview"><img src="${q.options[i].image}" alt="preview"><div class="remove-img" onclick="removeImage('option-${i}-image')">✕</div></div>`;
            preview.setAttribute('data-image', q.options[i].image);
        }
    }
    
    // Set correct answer radio button
    const correctRadio = document.querySelector(`input[name="correct-option"][value="${q.correct}"]`);
    if (correctRadio) {
        correctRadio.checked = true;
    }
    
    // Update question number display
    document.getElementById('current-q-number').innerText = `#${index + 1} (Editing ${subject})`;
    
    // Close the slide panel
    toggleSlidePanel();
    
    // Scroll to top of form
    document.getElementById('admin-create-test-screen2').scrollTo({ top: 0, behavior: 'smooth' });
}

// =============================================
// PUBLISH TEST (Placeholder for DB step)
// =============================================
async function publishTest() {
    const total = getTotalQuestionsCount();
    if (total !== currentTest.totalQuestions) {
        alert(`❌ Cannot publish!\n\nTotal questions required: ${currentTest.totalQuestions}\nQuestions added: ${total}\n\nPlease add the remaining questions.`);
        return;
    }
    
    const publishBtn = document.getElementById('publish-test-btn');
    publishBtn.innerText = '⏳ Publishing...';
    publishBtn.disabled = true;
    
    try {
        // 1. Get current user
        const { data: { user } } = await db.auth.getUser();
        if (!user) throw new Error('Not authenticated');
        
        // 2. Insert the test
        const { data: test, error: testError } = await db
            .from('tests')
            .insert({
                title: currentTest.title,
                test_type: 'free_mock',
                total_questions: currentTest.totalQuestions,
                max_marks: currentTest.maxMarks,
                duration: currentTest.duration,
                right_marks: currentTest.rightMarks,
                negative_marks: currentTest.negativeMarks,
                subjects: currentTest.subjects,
                optional_subjects: currentTest.optionalSubjects || null,
                created_by: user.id,
                is_published: true
            })
            .select()
            .single();
        
        if (testError) throw testError;
        
        // 3. Insert all questions
        const questionsToInsert = [];
        let globalQNumber = 1;
        
        for (const subject of currentTest.subjects) {
            const subjectQuestions = currentTest.questions[subject];
            subjectQuestions.forEach(q => {
                questionsToInsert.push({
                    test_id: test.id,
                    subject: subject,
                    question_number: globalQNumber,
                    question_text: q.text || null,
                    question_image: q.image || null,
                    options: q.options,
                    correct_option: q.correct
                });
                globalQNumber++;
            });
        }
        
        const { error: questionsError } = await db
            .from('questions')
            .insert(questionsToInsert);
        
        if (questionsError) throw questionsError;
        
        // 4. Success!
        alert(`🎉 Test Published Successfully!\n\nTitle: ${currentTest.title}\nTotal Questions: ${total}\n\nCandidates can now see this test in real-time!`);
        
        // 5. Reset and go back to admin home
        currentTest = null;
        currentSubject = null;
        currentQuestionIndex = 1;
        publishBtn.innerText = '🚀 Publish Mock Test';
        publishBtn.disabled = false;
        
    document.getElementById('admin-create-test-screen2').classList.add('hidden');
        goBackToAdminHome();
        
    } catch (error) {
        console.error('Publish Error:', error);
        alert('❌ Error publishing test: ' + error.message);
        publishBtn.innerText = '🚀 Publish Mock Test';
        publishBtn.disabled = false;
    }
}

// =============================================
// CANDIDATE: NAVIGATION
// =============================================
function goBackToCandidateHome() {
    // Hide ALL candidate sub-screens
    document.getElementById('candidate-free-mock-list').classList.add('hidden');
    document.getElementById('candidate-mini-mock-list').classList.add('hidden');
    document.getElementById('candidate-sectional-list').classList.add('hidden');
    document.getElementById('candidate-notif-list').classList.add('hidden');
    document.getElementById('candidate-downloads-screen').classList.add('hidden');
    
    // Show Dashboard
    document.getElementById('candidate-dashboard').classList.remove('hidden');
    document.getElementById('candidate-bottom-nav').classList.remove('hidden');
}

function showComingSoon(featureName) {
    alert(`🚧 ${featureName} feature is coming soon!\n\nStay tuned for updates.`);
}

function switchCandidateTab(tabName, clickedElement) {
    const navItems = document.querySelectorAll('#candidate-bottom-nav .nav-item');
    navItems.forEach(item => {
        item.classList.remove('active');
        item.classList.add('text-pink-100/70');
    });
    clickedElement.classList.add('active');
    clickedElement.classList.remove('text-pink-100/70');
    
    if (tabName === 'downloads') {
        document.getElementById('candidate-dashboard').classList.add('hidden');
        document.getElementById('candidate-downloads-screen').classList.remove('hidden');
        loadDownloadsTab(); // Load the saved PDFs
    } else if (tabName === 'profile') {
        showComingSoon('Profile');
    } else {
        // Home tab
        document.getElementById('candidate-downloads-screen').classList.add('hidden');
        document.getElementById('candidate-dashboard').classList.remove('hidden');
    }
}

// =============================================
// CANDIDATE: LOAD TESTS FROM SUPABASE
// =============================================
async function loadCandidateTests() {
    const container = document.getElementById('candidate-home-tests-list');
    container.innerHTML = '<p class="text-white/60 text-sm text-center py-4">Loading tests...</p>';
    
    try {
        const { data: tests, error } = await db
            .from('tests')
            .select('*')
            .eq('test_type', 'free_mock')
            .eq('is_published', true)
            .order('created_at', { ascending: false })
            .limit(3);
        
        if (error) throw error;
        
        if (!tests || tests.length === 0) {
            container.innerHTML = `
                <div class="text-center py-6">
                    <p class="text-4xl mb-2">📭</p>
                    <p class="text-white/70 text-sm">No tests available yet</p>
                    <p class="text-white/50 text-xs mt-1">Check back soon!</p>
                </div>
            `;
            return;
        }
        
        // Fetch attempts for each test
        const attemptsMap = {};
        await Promise.all(tests.map(async (test) => {
            attemptsMap[test.id] = await getUserAttemptsForTest(test.id);
        }));
        
        container.innerHTML = tests.map(test => {
            const attempts = attemptsMap[test.id];
            const attemptCount = attempts.length;
            let buttonHtml = '';
            
            if (attemptCount >= MAX_ATTEMPTS) {
                buttonHtml = `<button onclick="viewResult('${test.id}', ${attempts[0].attempt_number})" class="px-3 py-1.5 bg-blue-500/20 border border-blue-400/30 text-blue-100 text-xs font-bold rounded-lg">📊 View Result</button>`;
            } else if (attemptCount === 0) {
                buttonHtml = `<button onclick="startTest('${test.id}')" class="px-3 py-1.5 bg-white text-pink-700 text-xs font-bold rounded-lg">Attempt Now</button>`;
            } else {
                buttonHtml = `<button onclick="startTest('${test.id}')" class="px-3 py-1.5 bg-orange-500 text-white text-xs font-bold rounded-lg">🔄 Re-Attempt</button>`;
            }
            
            return `
                <div class="flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-lg">
                    <div class="flex-1">
                        <p class="text-white font-semibold text-sm">${test.title}</p>
                        <p class="text-pink-200/80 text-xs">${test.total_questions} Q • ${test.duration} min • ${test.max_marks} marks</p>
                        ${attemptCount > 0 ? `<p class="text-yellow-200 text-[10px] mt-0.5">Attempt ${attemptCount}/${MAX_ATTEMPTS}</p>` : ''}
                    </div>
                    ${buttonHtml}
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Load Tests Error:', error);
        container.innerHTML = `<p class="text-red-300 text-sm text-center py-4">Error loading tests</p>`;
    }
}

// =============================================
// CANDIDATE: SHOW ALL FREE MOCK TESTS
// =============================================
async function showCandidateFreeMockTests() {
    document.getElementById('candidate-dashboard').classList.add('hidden');
    document.getElementById('candidate-bottom-nav').classList.add('hidden');
    document.getElementById('candidate-free-mock-list').classList.remove('hidden');
    
    const container = document.getElementById('candidate-tests-container');
    container.innerHTML = '<p class="text-white/60 text-sm text-center py-8">Loading tests...</p>';
    
    try {
        // Fetch all published free mock tests
        const { data: tests, error } = await db
            .from('tests')
            .select('*')
            .eq('test_type', 'free_mock')
            .eq('is_published', true)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        if (!tests || tests.length === 0) {
            container.innerHTML = `
                <div class="glass-card p-8 text-center">
                    <p class="text-5xl mb-3">📭</p>
                    <p class="text-white font-semibold">No Free Mock Tests Available</p>
                    <p class="text-white/70 text-sm mt-2">Check back later for new tests!</p>
                </div>
            `;
            return;
        }
        
        // Fetch attempts for each test (in parallel for speed)
        const attemptsMap = {};
        await Promise.all(tests.map(async (test) => {
            attemptsMap[test.id] = await getUserAttemptsForTest(test.id);
        }));
        
        // Render tests with smart buttons
        container.innerHTML = tests.map(test => {
            const attempts = attemptsMap[test.id];
            const attemptCount = attempts.length;
            const attemptBadge = attemptCount > 0 ?
                `<span class="px-2 py-0.5 bg-yellow-500/20 border border-yellow-400/30 text-yellow-200 text-[10px] rounded">Attempted ${attemptCount}/${MAX_ATTEMPTS}</span>` :
                '';
            
            return `
                <div class="glass-card p-4 space-y-3">
                    <div class="flex justify-between items-start">
                        <div class="flex-1">
                            <h3 class="text-white font-bold text-lg">${test.title}</h3>
                            <p class="text-pink-200/80 text-xs mt-1">
                                ${new Date(test.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                        </div>
                        <div class="flex flex-col gap-1 items-end">
                            <span class="px-2 py-1 bg-green-500/20 border border-green-400/30 text-green-200 text-xs rounded-lg">FREE</span>
                            ${attemptBadge}
                        </div>
                    </div>
                    
                    <div class="grid grid-cols-3 gap-2 text-center">
                        <div class="p-2 bg-white/5 rounded-lg">
                            <p class="text-white/60 text-[10px]">Questions</p>
                            <p class="text-white font-bold text-sm">${test.total_questions}</p>
                        </div>
                        <div class="p-2 bg-white/5 rounded-lg">
                            <p class="text-white/60 text-[10px]">Duration</p>
                            <p class="text-white font-bold text-sm">${test.duration} min</p>
                        </div>
                        <div class="p-2 bg-white/5 rounded-lg">
                            <p class="text-white/60 text-[10px]">Max Marks</p>
                            <p class="text-white font-bold text-sm">${test.max_marks}</p>
                        </div>
                    </div>
                    
                    <div class="flex flex-wrap gap-1">
                        ${test.subjects.map(sub => `<span class="px-2 py-0.5 bg-white/10 border border-white/20 rounded text-[10px] text-white">${sub}</span>`).join('')}
                    </div>
                    
                    <div class="flex gap-2 pt-1">
                        <div class="flex-1 text-center text-xs text-pink-100">
                            <span class="text-white font-semibold">+${test.right_marks}</span> right
                        </div>
                        <div class="flex-1 text-center text-xs text-pink-100">
                            <span class="text-white font-semibold">-${test.negative_marks}</span> negative
                        </div>
                    </div>
                    
                    ${renderTestButtons(test.id, attempts)}
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Load Tests Error:', error);
        container.innerHTML = `<p class="text-red-300 text-sm text-center py-8">Error loading tests: ${error.message}</p>`;
    }
}

// =============================================
// CANDIDATE: START TEST (Placeholder for next step)
// =============================================
function startTest(testId) {
    alert(`🎯 Starting Test!\n\nTest ID: ${testId}\n\nNext Step: We will build the actual Test Taking Interface where candidates answer questions with a timer!`);
}

// =============================================
// CANDIDATE: ATTEMPT TRACKING
// =============================================
const MAX_ATTEMPTS = 3;

async function getUserAttemptsForTest(testId) {
    const { data: { user } } = await db.auth.getUser();
    if (!user) return [];
    
    const { data, error } = await db
        .from('test_attempts')
        .select('*')
        .eq('user_id', user.id)
        .eq('test_id', testId)
        .order('attempt_number', { ascending: false });
    
    if (error) {
        console.error('Fetch attempts error:', error);
        return [];
    }
    return data || [];
}

function renderTestButtons(testId, attempts) {
    const attemptCount = attempts.length;
    const latestAttempt = attempts[0]; // Most recent (ordered desc)
    
    // If reached max attempts
    if (attemptCount >= MAX_ATTEMPTS) {
        return `
            <div class="space-y-2">
                <button onclick="viewResult('${testId}', ${latestAttempt.attempt_number})" class="w-full py-2.5 bg-blue-500/20 border border-blue-400/30 text-blue-100 font-bold rounded-lg hover:bg-blue-500/30 transition active:scale-95">
                    📊 View Result (Attempt ${latestAttempt.attempt_number})
                </button>
                <p class="text-center text-xs text-yellow-200">⚠️ Maximum attempts (${MAX_ATTEMPTS}) reached</p>
            </div>
        `;
    }
    
    // If never attempted
    if (attemptCount === 0) {
        return `
            <button onclick="startTest('${testId}')" class="w-full py-2.5 bg-white text-pink-700 font-bold rounded-lg hover:bg-pink-50 transition active:scale-95">
                🚀 Attempt Now
            </button>
        `;
    }
    
    // If attempted 1 or 2 times (can re-attempt)
    return `
        <div class="flex gap-2">
            <button onclick="startTest('${testId}')" class="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-amber-600 text-white font-bold rounded-lg hover:opacity-90 transition active:scale-95">
                🔄 Re-Attempt
            </button>
            <button onclick="viewResult('${testId}', ${latestAttempt.attempt_number})" class="flex-1 py-2.5 bg-blue-500/20 border border-blue-400/30 text-blue-100 font-bold rounded-lg hover:bg-blue-500/30 transition active:scale-95">
                📊 View Result
            </button>
        </div>
        <p class="text-center text-xs text-pink-200 mt-1">Attempt ${attemptCount} of ${MAX_ATTEMPTS} used</p>
    `;
}

function viewResult(testId, attemptNumber) {
    alert(`📊 Viewing Result\n\nTest ID: ${testId}\nAttempt: ${attemptNumber}\n\nNext Step: We will build the detailed Result Screen showing score, correct/wrong answers, and time taken!`);
}

// =============================================
// TEST TAKING: START FLOW
// =============================================
async function startTest(testId) {
    try {
        // Fetch test details
        const { data: test, error } = await db
            .from('tests')
            .select('*')
            .eq('id', testId)
            .single();
        
        if (error) throw error;
        activeTest = test;
        
        // Fetch all questions for this test
        const { data: questions, error: qError } = await db
            .from('questions')
            .select('*')
            .eq('test_id', testId)
            .order('question_number', { ascending: true });
        
        if (qError) throw qError;
        activeQuestions = questions;
        
        // Reset state
        userAnswers = {};
        visitedQuestions = new Set();
        markedForReview = new Set();
        candidateCurrentQuestionIndex = 0; // Using renamed variable
        selectedOptionalSubject = null;
        
        // Check if test has optional subjects
        if (test.optional_subjects && test.optional_subjects.trim() !== '') {
            showOptionalSubjectScreen();
        } else {
            showTestInfoPopup();
        }
    } catch (error) {
        console.error('Start Test Error:', error);
        alert('❌ Error loading test: ' + error.message);
    }
}

// =============================================
// OPTIONAL SUBJECT SCREEN
// =============================================
function showOptionalSubjectScreen() {
    const screen = document.getElementById('optional-subject-screen');
    const list = document.getElementById('optional-subjects-list');    const confirmBtn = document.getElementById('confirm-optional-btn');
    
    // Parse optional subjects
    const optionalSubjects = activeTest.optional_subjects
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);
    
    list.innerHTML = optionalSubjects.map((sub, idx) => `
        <div class="optional-subject-card" onclick="selectOptionalSubject('${sub}', this)" data-subject="${sub}">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 bg-pink-100 rounded-full flex items-center justify-center text-pink-700 font-bold">${idx + 1}</div>
                <div class="flex-1">
                    <p class="font-semibold text-gray-800">${sub}</p>
                    <p class="text-xs text-gray-500">Tap to select this subject</p>
                </div>
                <div class="w-6 h-6 border-2 border-gray-300 rounded-full check-indicator"></div>
            </div>
        </div>
    `).join('');
    
    confirmBtn.disabled = true;
    screen.classList.remove('hidden');
}

function selectOptionalSubject(subject, element) {
    selectedOptionalSubject = subject;
    
    // Update UI
    document.querySelectorAll('.optional-subject-card').forEach(card => {
        card.classList.remove('selected');
        card.querySelector('.check-indicator').style.background = 'transparent';
        card.querySelector('.check-indicator').style.borderColor = '#d1d5db';
    });
    
    element.classList.add('selected');
    element.querySelector('.check-indicator').style.background = '#9d174d';
    element.querySelector('.check-indicator').style.borderColor = '#9d174d';
    
    document.getElementById('confirm-optional-btn').disabled = false;
}

function confirmOptionalSubject() {
    if (!selectedOptionalSubject) {
        alert('Please select an optional subject');
        return;
    }
    document.getElementById('optional-subject-screen').classList.add('hidden');
    showTestInfoPopup();
}
function cancelOptionalSelection() {
    document.getElementById('optional-subject-screen').classList.add('hidden');
    selectedOptionalSubject = null;
}

// =============================================
// TEST INFO POPUP
// =============================================
function showTestInfoPopup() {
    document.getElementById('popup-test-title').innerText = activeTest.title;
    document.getElementById('popup-total-q').innerText = activeTest.total_questions;
    document.getElementById('popup-max-marks').innerText = activeTest.max_marks;
    document.getElementById('popup-duration').innerText = activeTest.duration + ' min';
    document.getElementById('popup-marking').innerText = `+${activeTest.right_marks} / -${activeTest.negative_marks}`;
    
    document.getElementById('test-info-popup').classList.remove('hidden');
}

function closeTestInfoPopup() {
    document.getElementById('test-info-popup').classList.add('hidden');
}

// =============================================
// ACTUAL TEST START
// =============================================
function startActualTest() {
    closeTestInfoPopup();
    
    // Filter questions if optional subject selected (for Free Mocks)
    if (selectedOptionalSubject) {
        activeQuestions = activeQuestions.filter(q => q.subject === selectedOptionalSubject);
    }
    
    if (activeQuestions.length === 0) {
        alert('No questions available for this selection');
        return;
    }
    
    // Hide candidate dashboard and nav
    document.getElementById('candidate-dashboard').classList.add('hidden');
    document.getElementById('candidate-bottom-nav').classList.add('hidden');
    document.getElementById('candidate-free-mock-list').classList.add('hidden');
    document.getElementById('candidate-mini-mock-list').classList.add('hidden');
    document.getElementById('candidate-sectional-list').classList.add('hidden');
    
    // Show test interface
    document.getElementById('test-interface').classList.remove('hidden');
    document.getElementById('test-candidate-name').innerText = document.getElementById('candidate-name').innerText;
    
    // CHECK IF SECTIONAL TEST
    if (activeTest.test_type === 'sectional_timer' && activeTest.sectional_timers) {
        isSectionalTest = true;
        sectionalTimers = activeTest.sectional_timers;
        currentSectionIndex = 0;
        
        renderTestSubjectTabs(); // Will render with restricted tabs
        loadSection(0); // Load first section
        startSectionalTimer();
    } else {
        isSectionalTest = false;
        timeRemaining = activeTest.duration * 60;
        renderTestSubjectTabs();
        loadQuestion(0);
        startTimer();
    }
}

// =============================================
// TIMER
// =============================================
function startTimer() {
    updateTimerDisplay();
    testTimer = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();
        
        if (timeRemaining <= 0) {
            clearInterval(testTimer);
            alert(' Time is up! Your test will be submitted automatically.');
            submitTest(true);
        }
    }, 1000);
}

function updateTimerDisplay() {
    const hours = Math.floor(timeRemaining / 3600);
    const minutes = Math.floor((timeRemaining % 3600) / 60);
    const seconds = timeRemaining % 60;
    
    const display = document.getElementById('timer-display');
    display.innerText = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    // Turn red at 30% remaining
    const totalTime = activeTest.duration * 60;
    const threshold = totalTime * 0.3;
    if (timeRemaining <= threshold) {
        display.classList.add('danger');
    } else {
        display.classList.remove('danger');
    }
}

// =============================================
// SUBJECT TABS IN TEST
// =============================================
function renderTestSubjectTabs() {    const container = document.getElementById('test-subject-tabs');
    const subjects = [...new Set(activeQuestions.map(q => q.subject))];
    
    container.innerHTML = subjects.map((sub, idx) => `
        <button class="subject-tab-test ${idx === 0 ? 'active' : ''}" onclick="jumpToSubject('${sub}', this)">
            ${sub}
        </button>
    `).join('');
    
    currentSubjectInTest = subjects[0];
}

function jumpToSubject(subject, btnElement) {
    currentSubjectInTest = subject;
    
    // Update active tab
    document.querySelectorAll('.subject-tab-test').forEach(tab => tab.classList.remove('active'));
    btnElement.classList.add('active');
    
    // Find first question of this subject
    const firstQuestionIndex = activeQuestions.findIndex(q => q.subject === subject);
    if (firstQuestionIndex !== -1) {
        loadQuestion(firstQuestionIndex);
    }
}

// =============================================
// LOAD QUESTION
// =============================================
function loadQuestion(index) {
    if (index < 0 || index >= activeQuestions.length) return;
    
    candidateCurrentQuestionIndex = index;
    const question = activeQuestions[index];
    
    // Mark as visited
    visitedQuestions.add(question.id);
    
    // Update header info
    document.getElementById('test-current-q-num').innerText = question.question_number;
    document.getElementById('test-total-q-display').innerText = activeQuestions.length;
    document.getElementById('test-current-subject').innerText = question.subject;
    
    // Render question content
    const contentDiv = document.getElementById('test-question-content');
    let contentHtml = '';
    if (question.question_text) {
        contentHtml += `<div class="question-text">${question.question_text}</div>`;
    }
    if (question.question_image) {        contentHtml += `<img src="${question.question_image}" alt="Question image" class="w-full rounded-lg mb-4">`;
    }
    contentDiv.innerHTML = contentHtml;
    
    // Render options
    const optionsContainer = document.getElementById('test-options-container');
    const selectedOption = userAnswers[question.id];
    
    optionsContainer.innerHTML = question.options.map((opt, idx) => {
        const isSelected = selectedOption === idx;
        let optHtml = `<div class="option-text">${opt.text || ''}</div>`;
        if (opt.image) {
            optHtml += `<img src="${opt.image}" alt="Option image" class="w-full rounded">`;
        }
        return `
            <div class="option-item ${isSelected ? 'selected' : ''}" onclick="selectOption(${idx})">
                <input type="radio" name="test-option" value="${idx}" ${isSelected ? 'checked' : ''}>
                ${optHtml}
            </div>
        `;
    }).join('');
    
    // Update palette if open
    if (document.getElementById('question-palette-panel').classList.contains('open')) {
        renderQuestionPalette();
    }
}

function selectOption(optionIndex) {
    const question = activeQuestions[candidateCurrentQuestionIndex];
    userAnswers[question.id] = optionIndex;
    
    // Update UI
    document.querySelectorAll('.option-item').forEach((item, idx) => {
        item.classList.toggle('selected', idx === optionIndex);
        item.querySelector('input[type="radio"]').checked = (idx === optionIndex);
    });
    
    // Update palette
    if (document.getElementById('question-palette-panel').classList.contains('open')) {
        renderQuestionPalette();
    }
}

// =============================================
// BOTTOM ACTION BUTTONS
// =============================================
function previousQuestion() {
    if (isSectionalTest) {
        // In sectional mode: Only move to previous question WITHIN the same section
        const currentSectionName = sectionalTimers[currentSectionIndex].name;
        
        // Find previous question in the SAME section
        let prevIndex = -1;
        for (let i = candidateCurrentQuestionIndex - 1; i >= 0; i--) {
            if (activeQuestions[i].subject === currentSectionName) {
                prevIndex = i;
                break;
            }
        }
        
        if (prevIndex !== -1) {
            loadQuestion(prevIndex);
        } else {
            alert('This is the first question in this section.');
        }
    } else {
        // Normal mode
        if (candidateCurrentQuestionIndex > 0) {
            loadQuestion(candidateCurrentQuestionIndex - 1);
        } else {
            alert('This is the first question');
        }
    }
}

function clearResponse() {
    const question = activeQuestions[candidateCurrentQuestionIndex];
    delete userAnswers[question.id];
    loadQuestion(candidateCurrentQuestionIndex);
}

function markForReview() {
    const question = activeQuestions[candidateCurrentQuestionIndex];
    if (markedForReview.has(question.id)) {
        markedForReview.delete(question.id);
        alert('Mark for review removed');
    } else {
        markedForReview.add(question.id);
        alert('Question marked for review');
    }
    if (document.getElementById('question-palette-panel').classList.contains('open')) {
        renderQuestionPalette();
    }
}

function saveAndNext() {
    if (isSectionalTest) {
        // In sectional mode: Only move to next question WITHIN the same section
        const currentSectionName = sectionalTimers[currentSectionIndex].name;
        
        // Find next question in the SAME section
        let nextIndex = -1;
        for (let i = candidateCurrentQuestionIndex + 1; i < activeQuestions.length; i++) {
            if (activeQuestions[i].subject === currentSectionName) {
                nextIndex = i;
                break;
            }
        }
        
        if (nextIndex !== -1) {
            // Found next question in same section
            loadQuestion(nextIndex);
        } else {
            // No more questions in this section, but DON'T move to next section
            alert(`✅ You've completed all questions in ${currentSectionName}!\n\nPlease wait for the timer to end. You cannot move to the next section until the time is up.\n\nRemaining time will be shown on the timer.`);
        }
    } else {
        // Normal mode (Free Mock / Mini Mock)
        if (candidateCurrentQuestionIndex < activeQuestions.length - 1) {
            loadQuestion(candidateCurrentQuestionIndex + 1);
        } else {
            alert('This is the last question. Click Submit to finish the test.');
        }
    }
}

function submitTest(autoSubmit = false) {
    const answeredCount = Object.keys(userAnswers).length;
    const totalQuestions = activeQuestions.length;
    
    if (!autoSubmit) {
        const confirmed = confirm(`⚠️ Submit Test?\n\nAnswered: ${answeredCount}/${totalQuestions}\nUnanswered: ${totalQuestions - answeredCount}\n\nAre you sure you want to submit?`);
        if (!confirmed) return;
    }
    
    // Stop timer
    clearInterval(testTimer);
    
    // Calculate score
    let correct = 0;
    let wrong = 0;
    let unattempted = 0;
    let score = 0;    
    activeQuestions.forEach(q => {
        const userAnswer = userAnswers[q.id];
        if (userAnswer === undefined || userAnswer === null) {
            unattempted++;
        } else if (userAnswer === q.correct_option) {
            correct++;
            score += parseFloat(activeTest.right_marks);
        } else {
            wrong++;
            score -= parseFloat(activeTest.negative_marks);
        }
    });
    
    // Prevent negative total score
    if (score < 0) score = 0;
    
    // Save attempt to database
    saveTestAttempt(correct, wrong, unattempted, score);
}

// =============================================
// SAVE TEST ATTEMPT
// =============================================
async function saveTestAttempt(correct, wrong, unattempted, score) {
    try {
        const { data: { user } } = await db.auth.getUser();
        if (!user) throw new Error('Not authenticated');
        
        // Get current attempt number
        const { data: existingAttempts } = await db
            .from('test_attempts')
            .select('attempt_number')
            .eq('user_id', user.id)
            .eq('test_id', activeTest.id)
            .order('attempt_number', { ascending: false })
            .limit(1);
        
        const attemptNumber = (existingAttempts && existingAttempts.length > 0) 
            ? existingAttempts[0].attempt_number + 1 
            : 1;
        
        const timeTaken = (activeTest.duration * 60) - timeRemaining;
        
        const { error } = await db
            .from('test_attempts')
            .insert({
                user_id: user.id,
                test_id: activeTest.id,
                attempt_number: attemptNumber,                score: score,
                total_questions: activeQuestions.length,
                correct_answers: correct,
                wrong_answers: wrong,
                unattempted: unattempted,
                time_taken: timeTaken
            });
        
        if (error) throw error;
        
        // Show result screen (placeholder for next step)
        showResultScreen(score, correct, wrong, unattempted, attemptNumber, timeTaken);
        
    } catch (error) {
        console.error('Save Attempt Error:', error);
        alert('❌ Error saving attempt: ' + error.message);
    }
}

// =============================================
// RESULT SCREEN LOGIC
// =============================================
let resultStats = {};

async function showResultScreen(score, correct, wrong, unattempted, attemptNumber, timeTaken) {
    // Hide test interface
    document.getElementById('test-interface').classList.add('hidden');
    document.getElementById('question-palette-overlay').classList.remove('open');
    document.getElementById('question-palette-panel').classList.remove('open');
    
    // Show loading or basic info first
    document.getElementById('result-screen').classList.remove('hidden');
    document.getElementById('result-exam-name').innerText = activeTest.title;
    document.getElementById('result-candidate-name').innerText = document.getElementById('candidate-name').innerText;
    
    // 1. Calculate Rank & Percentile from Database
    await calculateRankAndPercentile(score);
    
    // 2. Calculate Accuracy
    const attempted = correct + wrong;
    const accuracy = attempted > 0 ? ((correct / attempted) * 100).toFixed(2) : 0;
    
    // 3. Update Overview DOM
    document.getElementById('res-score').innerText = score;
    document.getElementById('res-max-marks').innerText = activeTest.max_marks;
    document.getElementById('res-correct-count').innerText = correct;
    document.getElementById('res-incorrect-count').innerText = wrong;
    document.getElementById('res-unattempted-count').innerText = unattempted;
    document.getElementById('res-total-q-stats').innerText = activeQuestions.length + ' Questions';
    document.getElementById('res-accuracy').innerText = accuracy + '%';
    
    // Cut off message logic (simple 40% check)
    const cutOffMsg = document.getElementById('res-cut-off-msg');
    if (score >= (activeTest.max_marks * 0.4)) {
        cutOffMsg.innerText = "Congratulations! You have cleared the cut off.";
        cutOffMsg.className = "text-sm font-semibold mt-2 text-green-600";
    } else {
        cutOffMsg.innerText = "Keep practicing! You can do better.";
        cutOffMsg.className = "text-sm font-semibold mt-2 text-red-500";
    }

    // 4. Render Question Tabs
    renderQuestionReviews();
    
    // Reset to Overview tab
    switchResultTab('overview');
}

async function calculateRankAndPercentile(userScore) {    try {
        // Fetch all attempts for this test
        const { data: attempts, error } = await db
            .from('test_attempts')
            .select('score')
            .eq('test_id', activeTest.id)
            .order('score', { ascending: false });
            
        if (error) throw error;
        
        if (attempts && attempts.length > 0) {
            const totalCandidates = attempts.length;
            
            // Calculate Rank (1-based index)
            // Find first index where score is less than userScore
            let rank = totalCandidates; 
            for (let i = 0; i < totalCandidates; i++) {
                if (attempts[i].score < userScore) {
                    rank = i + 1;
                    break;
                }
            }
            // If user has highest score
            if (userScore >= attempts[0].score) rank = 1;
            
            document.getElementById('res-rank').innerText = rank + ' / ' + totalCandidates;
            
            // Calculate Percentile: % of candidates who scored <= user
            let countBelow = 0;
            for (let i = 0; i < totalCandidates; i++) {
                if (attempts[i].score <= userScore) countBelow++;
            }
            const percentile = ((countBelow / totalCandidates) * 100).toFixed(2);
            document.getElementById('res-percentile').innerText = percentile + '%';
        } else {
            document.getElementById('res-rank').innerText = '1 / 1';
            document.getElementById('res-percentile').innerText = '100%';
        }
    } catch (e) {
        console.error("Rank calc error", e);
        document.getElementById('res-rank').innerText = '-';
        document.getElementById('res-percentile').innerText = '-';
    }
}

function renderQuestionReviews() {
    const correctList = document.getElementById('correct-questions-list');
    const incorrectList = document.getElementById('incorrect-questions-list');
    const unattemptedList = document.getElementById('unattempted-questions-list');
        correctList.innerHTML = '';
    incorrectList.innerHTML = '';
    unattemptedList.innerHTML = '';
    
    activeQuestions.forEach((q, index) => {
        const userAns = userAnswers[q.id];
        const isCorrect = userAns === q.correct_option;
        const isUnattempted = userAns === undefined || userAns === null;
        
        let html = generateQuestionReviewHTML(q, index, userAns);
        
        if (isUnattempted) {
            unattemptedList.innerHTML += `<div class="review-card unattempted">${html}</div>`;
        } else if (isCorrect) {
            correctList.innerHTML += `<div class="review-card correct">${html}</div>`;
        } else {
            incorrectList.innerHTML += `<div class="review-card incorrect">${html}</div>`;
        }
    });
    
    // Empty state messages
    if (correctList.innerHTML === '') correctList.innerHTML = '<p class="text-center text-gray-500 py-10">No correct answers.</p>';
    if (incorrectList.innerHTML === '') incorrectList.innerHTML = '<p class="text-center text-gray-500 py-10">No incorrect answers. Great job!</p>';
    if (unattemptedList.innerHTML === '') unattemptedList.innerHTML = '<p class="text-center text-gray-500 py-10">No unattempted questions.</p>';
}

function generateQuestionReviewHTML(q, index, userAns) {
    let optionsHtml = '';
    const labels = ['A', 'B', 'C', 'D'];
    
    q.options.forEach((opt, i) => {
        let icon = '';
        let classes = 'review-option';
        
        if (i === q.correct_option) {
            icon = '✔';
            classes += ' correct-answer';
        }
        if (i === userAns && userAns !== q.correct_option) {
            icon = '✖';
            classes += ' user-answer';
        }
        if (i === userAns && userAns === q.correct_option) {
            icon = '✔'; // Already handled by correct logic, but ensures checkmark
        }
        
        optionsHtml += `
            <div class="${classes}">
                <span class="review-option-icon">${icon}</span>
                <span><b>${labels[i]}.</b> ${opt.text || 'Option ' + labels[i]}</span>            </div>
        `;
    });
    
    return `
        <div class="review-header">
            <span>Question ${index + 1}</span>
            <span class="font-semibold text-pink-700">${q.subject}</span>
        </div>
        <div class="review-q-text">${q.question_text || 'Image Question'}</div>
        <div class="options-list">
            ${optionsHtml}
        </div>
        <div class="mt-3 text-xs text-gray-500 flex justify-between">
            <span>Marking: +${activeTest.right_marks} / -${activeTest.negative_marks}</span>
        </div>
    `;
}

// =============================================
// RESULT SCREEN NAVIGATION & ACTIONS
// =============================================
function switchResultTab(tabName) {
    // Hide all contents
    document.querySelectorAll('.result-tab-content').forEach(el => el.classList.add('hidden'));
    // Show selected
    document.getElementById('tab-' + tabName).classList.remove('hidden');
    
    // Update tab styles
    document.querySelectorAll('.result-tab').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.remove('text-pink-700', 'border-b-2', 'border-pink-700');
        btn.classList.add('text-gray-500');
    });
    
    // Highlight active button (find by onclick attribute match)
    const activeBtn = document.querySelector(`button[onclick="switchResultTab('${tabName}')"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.classList.remove('text-gray-500');
        activeBtn.classList.add('text-pink-700', 'border-b-2', 'border-pink-700');
    }
}

function exitResultScreen() {
    document.getElementById('result-screen').classList.add('hidden');
    document.getElementById('candidate-dashboard').classList.remove('hidden');
    document.getElementById('candidate-bottom-nav').classList.remove('hidden');
    loadCandidateTests(); // Refresh list to show new attempt count
}
function shareResult() {
    const text = `I scored ${document.getElementById('res-score').innerText}/${document.getElementById('res-max-marks').innerText} in ${activeTest.title} on MockPrep! My Percentile is ${document.getElementById('res-percentile').innerText}. Can you beat me?`;
    
    if (navigator.share) {
        navigator.share({
            title: 'My MockPrep Result',
            text: text,
            url: window.location.href
        }).catch(console.error);
    } else {
        alert("Share Result:\n\n" + text);
    }
}

function downloadResultPDF() {
    // Switch to overview tab to ensure it's visible for printing
    switchResultTab('overview');
    window.print();
}

// =============================================
// QUESTION PALETTE
// =============================================
function toggleQuestionPalette() {
    const panel = document.getElementById('question-palette-panel');
    const overlay = document.getElementById('question-palette-overlay');
    panel.classList.toggle('open');
    overlay.classList.toggle('open');
    
    if (panel.classList.contains('open')) {
        renderQuestionPalette();
    }}

function renderQuestionPalette() {
    document.getElementById('palette-subject-title').innerText = currentSubjectInTest || 'All Questions';
    
    const grid = document.getElementById('palette-questions-grid');
    const subjectQuestions = activeQuestions.filter(q => q.subject === currentSubjectInTest);
    
    grid.innerHTML = subjectQuestions.map((q, idx) => {
        let statusClass = 'not-visited';
        if (markedForReview.has(q.id)) {
            statusClass = 'marked';
        } else if (userAnswers[q.id] !== undefined) {
            statusClass = 'answered';
        } else if (visitedQuestions.has(q.id)) {
            statusClass = 'not-answered';
        }
        
        return `
            <button class="palette-question-btn ${statusClass}" onclick="jumpToQuestion(${activeQuestions.indexOf(q)})">
                ${q.question_number}
            </button>
        `;
    }).join('');
}

function jumpToQuestion(index) {
    loadQuestion(index);
    toggleQuestionPalette();
}

function reportQuestion() {
    const question = activeQuestions[candidateCurrentQuestionIndex];
    alert(`📝 Question Reported\n\nQuestion #${question.question_number} has been reported to admin for review.`);
}

// =============================================
// MINI MOCK TEST - ADMIN LOGIC
// =============================================
let currentMiniMock = null;
let miniMockQuestions = [];
let miniMockCurrentQNum = 1;

// Navigation
function showAdminMiniMockScreen1() {
    document.getElementById('admin-dashboard').classList.add('hidden');
    document.getElementById('admin-bottom-nav').classList.add('hidden');
    document.getElementById('admin-mini-mock-screen1').classList.remove('hidden');
}

function goBackToAdminHome() {
    // Hide ALL admin sub-screens
    document.getElementById('admin-create-test-screen1').classList.add('hidden');
    document.getElementById('admin-create-test-screen2').classList.add('hidden');
    document.getElementById('admin-mini-mock-screen1').classList.add('hidden');
    document.getElementById('admin-mini-mock-screen2').classList.add('hidden');
    document.getElementById('admin-sectional-screen1').classList.add('hidden');
    document.getElementById('admin-sectional-screen2').classList.add('hidden');
    document.getElementById('admin-notification-screen').classList.add('hidden');
    
    // Show Dashboard
    document.getElementById('admin-dashboard').classList.remove('hidden');
    document.getElementById('admin-bottom-nav').classList.remove('hidden');
}

function goBackToMiniMockScreen1() {
    if (miniMockQuestions.length > 0) {
        if (!confirm('Going back will keep saved questions. Continue?')) return;
    }
    document.getElementById('admin-mini-mock-screen2').classList.add('hidden');
    document.getElementById('admin-mini-mock-screen1').classList.remove('hidden');
}

// Screen 1 Handler
function handleMiniMockScreen1Submit() {
    const title = document.getElementById('mini-title').value.trim();
    const subject = document.getElementById('mini-subject').value.trim();
    const questions = parseInt(document.getElementById('mini-questions').value);
    const duration = parseInt(document.getElementById('mini-duration').value);
    const maxMarks = parseFloat(document.getElementById('mini-max-marks').value);
    const rightMarks = parseFloat(document.getElementById('mini-right-marks').value);
    const negativeMarks = parseFloat(document.getElementById('mini-negative-marks').value);

    // Validations
    if (!title || !subject || !questions || !duration || !maxMarks) {
        alert('Please fill all required fields.');
        return;
    }
    if (questions > 30) { alert('Maximum 30 questions allowed for Mini Mock.'); return; }
    if (duration > 30) { alert('Maximum 30 minutes allowed for Mini Mock.'); return; }

    // Save state
    currentMiniMock = {
        title, subject, totalQuestions: questions, duration, maxMarks, rightMarks, negativeMarks    };
    miniMockQuestions = [];
    miniMockCurrentQNum = 1;

    // Clear inputs
    document.getElementById('mini-title').value = '';
    document.getElementById('mini-subject').value = '';
    document.getElementById('mini-questions').value = '';
    document.getElementById('mini-duration').value = '';
    document.getElementById('mini-max-marks').value = '';
    document.getElementById('mini-right-marks').value = '';
    document.getElementById('mini-negative-marks').value = '';

    // Go to Screen 2
    document.getElementById('admin-mini-mock-screen1').classList.add('hidden');
    document.getElementById('admin-mini-mock-screen2').classList.remove('hidden');
    
    document.getElementById('mini-screen2-subject-header').innerText = subject;
    document.getElementById('mini-q-total').innerText = questions;
    updateMiniMockProgress();
    clearMiniMockForm();
}

// Image Upload (Reusing logic adapted for Mini Mock IDs)
function handleMiniImageUpload(event, targetId) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 1048576) { // 1MB limit
        alert('Image too large! Max 1MB.');
        event.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
        const preview = document.getElementById(targetId + '-preview');
        preview.innerHTML = `<div class="relative inline-block"><img src="${e.target.result}" class="max-h-20 rounded border"><button onclick="removeMiniImage('${targetId}')" class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">✕</button></div>`;
        preview.setAttribute('data-image', e.target.result);
    };
    reader.readAsDataURL(file);
}

function removeMiniImage(targetId) {
    const preview = document.getElementById(targetId + '-preview');
    preview.innerHTML = '';
    preview.removeAttribute('data-image');
}

// Save Question
function saveMiniMockQuestion() {
    const qText = document.getElementById('mini-question-text').value.trim();    const qImg = document.getElementById('mini-q-img-preview').getAttribute('data-image') || null;
    
    if (!qText && !qImg) { alert('Please enter question text or upload image.'); return; }

    const options = [];
    for (let i = 0; i < 4; i++) {
        const optText = document.getElementById('mini-opt-' + i).value.trim();
        const optImg = document.getElementById('mini-opt-' + i + '-img-preview').getAttribute('data-image') || null;
        if (!optText && !optImg) { alert(`Option ${String.fromCharCode(65+i)} is empty.`); return; }
        options.push({ text: optText, image: optImg });
    }

    const correctOpt = parseInt(document.querySelector('input[name="mini-correct-opt"]:checked').value);

    miniMockQuestions.push({
        id: miniMockCurrentQNum,
        text: qText, image: qImg, options, correct: correctOpt
    });

    updateMiniMockProgress();
    clearMiniMockForm();
    miniMockCurrentQNum++;
    document.getElementById('mini-current-q-num').innerText = '#' + miniMockCurrentQNum;

    if (miniMockQuestions.length >= currentMiniMock.totalQuestions) {
        document.getElementById('mini-publish-btn').classList.remove('hidden');
        alert('All questions added! You can now publish.');
    } else {
        alert(`Question saved! (${miniMockQuestions.length}/${currentMiniMock.totalQuestions})`);
    }
}

function clearMiniMockForm() {
    document.getElementById('mini-question-text').value = '';
    removeMiniImage('mini-q-img');
    for (let i = 0; i < 4; i++) {
        document.getElementById('mini-opt-' + i).value = '';
        removeMiniImage('mini-opt-' + i + '-img');
    }
    document.querySelector('input[name="mini-correct-opt"][value="0"]').checked = true;
}

function updateMiniMockProgress() {
    document.getElementById('mini-q-count').innerText = miniMockQuestions.length;
}

// Publish to Database
async function publishMiniMock() {
    if (miniMockQuestions.length !== currentMiniMock.totalQuestions) {
        alert('Please add all questions before publishing.');        return;
    }

    const btn = document.getElementById('mini-publish-btn');
    btn.innerText = 'Publishing...';
    btn.disabled = true;

    try {
        const { data: { user } } = await db.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        // 1. Insert Test
        const { data: test, error: testError } = await db
            .from('tests')
            .insert({
                title: currentMiniMock.title,
                test_type: 'mini_mock', // CRITICAL: This tags it for the Mini Mock tab
                total_questions: currentMiniMock.totalQuestions,
                max_marks: currentMiniMock.maxMarks,
                duration: currentMiniMock.duration,
                right_marks: currentMiniMock.rightMarks,
                negative_marks: currentMiniMock.negativeMarks,
                subjects: [currentMiniMock.subject], // Array with single subject
                optional_subjects: null,
                created_by: user.id,
                is_published: true
            })
            .select().single();

        if (testError) throw testError;

        // 2. Insert Questions
        const questionsToInsert = miniMockQuestions.map(q => ({
            test_id: test.id,
            subject: currentMiniMock.subject,
            question_number: q.id,
            question_text: q.text,
            question_image: q.image,
            options: q.options,
            correct_option: q.correct
        }));

        const { error: qError } = await db.from('questions').insert(questionsToInsert);
        if (qError) throw qError;

        alert(' Mini Mock Test Published Successfully!');
        
        // Reset and go home
        currentMiniMock = null;
        miniMockQuestions = [];        btn.innerText = ' Publish Mini Mock Test';
        btn.disabled = false;
        document.getElementById('mini-publish-btn').classList.add('hidden');
        goBackToAdminHome();

    } catch (error) {
        console.error('Publish Error:', error);
        alert('Error: ' + error.message);
        btn.innerText = ' Publish Mini Mock Test';
        btn.disabled = false;
    }
}

// =============================================
// CANDIDATE: MINI MOCK TESTS
// =============================================
async function showCandidateMiniMocks() {
    // Hide home, show mini mock list
    document.getElementById('candidate-dashboard').classList.add('hidden');
    document.getElementById('candidate-bottom-nav').classList.add('hidden');
    document.getElementById('candidate-mini-mock-list').classList.remove('hidden');
    
    const container = document.getElementById('candidate-mini-mocks-container');
    container.innerHTML = '<p class="text-white/60 text-sm text-center py-8">Loading tests...</p>';
    
    try {
        // Fetch all published mini mock tests
        const { data: tests, error } = await db
            .from('tests')
            .select('*')
            .eq('test_type', 'mini_mock')
            .eq('is_published', true)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        if (!tests || tests.length === 0) {
            container.innerHTML = `
                <div class="glass-card p-8 text-center">
                    <p class="text-5xl mb-3">⏱️</p>
                    <p class="text-white font-semibold">No Mini Mock Tests Available</p>
                    <p class="text-white/70 text-sm mt-2">Check back later for quick practice tests!</p>
                </div>
            `;
            return;
        }
        
        // Fetch attempts for each test (in parallel for speed)
        const attemptsMap = {};
        await Promise.all(tests.map(async (test) => {
            attemptsMap[test.id] = await getUserAttemptsForTest(test.id);
        }));
        
        // Render tests with smart buttons
        container.innerHTML = tests.map(test => {
            const attempts = attemptsMap[test.id];
            const attemptCount = attempts.length;
            const attemptBadge = attemptCount > 0 
                ? `<span class="px-2 py-0.5 bg-yellow-500/20 border border-yellow-400/30 text-yellow-200 text-[10px] rounded">Attempted ${attemptCount}/${MAX_ATTEMPTS}</span>`
                : '';
            
            return `
                <div class="glass-card p-4 space-y-3">                    <div class="flex justify-between items-start">
                        <div class="flex-1">
                            <h3 class="text-white font-bold text-lg">${test.title}</h3>
                            <p class="text-pink-200/80 text-xs mt-1">
                                ${new Date(test.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                        </div>
                        <div class="flex flex-col gap-1 items-end">
                            <span class="px-2 py-1 bg-blue-500/20 border border-blue-400/30 text-blue-200 text-xs rounded-lg">MINI</span>
                            ${attemptBadge}
                        </div>
                    </div>
                    
                    <!-- Subject Badge -->
                    <div class="flex items-center gap-2">
                        <span class="px-3 py-1 bg-white/20 border border-white/30 rounded-full text-xs text-white font-medium">
                            📚 ${test.subjects[0]}
                        </span>
                    </div>
                    
                    <div class="grid grid-cols-3 gap-2 text-center">
                        <div class="p-2 bg-white/5 rounded-lg">
                            <p class="text-white/60 text-[10px]">Questions</p>
                            <p class="text-white font-bold text-sm">${test.total_questions}</p>
                        </div>
                        <div class="p-2 bg-white/5 rounded-lg">
                            <p class="text-white/60 text-[10px]">Duration</p>
                            <p class="text-white font-bold text-sm">${test.duration} min</p>
                        </div>
                        <div class="p-2 bg-white/5 rounded-lg">
                            <p class="text-white/60 text-[10px]">Max Marks</p>
                            <p class="text-white font-bold text-sm">${test.max_marks}</p>
                        </div>
                    </div>
                    
                    <div class="flex gap-2 pt-1">
                        <div class="flex-1 text-center text-xs text-pink-100">
                            <span class="text-white font-semibold">+${test.right_marks}</span> right
                        </div>
                        <div class="flex-1 text-center text-xs text-pink-100">
                            <span class="text-white font-semibold">-${test.negative_marks}</span> negative
                        </div>
                    </div>
                    
                    ${renderTestButtons(test.id, attempts)}
                </div>
            `;
        }).join('');
        
    } catch (error) {        console.error('Load Mini Mocks Error:', error);
        container.innerHTML = `<p class="text-red-300 text-sm text-center py-8">Error loading tests: ${error.message}</p>`;
    }
}

// Reuse the existing attempt tracking and button rendering functions
// They work for ALL test types automatically!

// =============================================
// SECTIONAL TIMER TEST - ADMIN LOGIC
// =============================================
let currentSectionalTest = null;
let sectionalSubjects = []; // [{name: 'Math', time: 20}, ...]
let sectionalQuestions = {}; // { 'Math': [q1, q2], 'English': [q3] }
let currentSecSubject = null;
let secCurrentQNum = 1;

// Navigation
function showAdminSectionalScreen1() {
    document.getElementById('admin-dashboard').classList.add('hidden');
    document.getElementById('admin-bottom-nav').classList.add('hidden');
    document.getElementById('admin-sectional-screen1').classList.remove('hidden');
    sectionalSubjects = [];
    renderSectionalSubjectsList();
}

function goBackToAdminHome() {
    document.getElementById('admin-sectional-screen1').classList.add('hidden');
    document.getElementById('admin-sectional-screen2').classList.add('hidden');
    document.getElementById('admin-dashboard').classList.remove('hidden');
    document.getElementById('admin-bottom-nav').classList.remove('hidden');
}

function goBackToSectionalScreen1() {
    if (Object.values(sectionalQuestions).flat().length > 0) {
        if (!confirm('Going back will keep saved questions. Continue?')) return;
    }
    document.getElementById('admin-sectional-screen2').classList.add('hidden');
    document.getElementById('admin-sectional-screen1').classList.remove('hidden');
}

// Dynamic Subjects Logic
function addSectionalSubject() {
    const name = document.getElementById('new-sec-name').value.trim();
    const time = parseInt(document.getElementById('new-sec-time').value);

    if (!name || !time) { alert('Please enter subject name and time.'); return; }
    if (time <= 0) { alert('Time must be greater than 0.'); return; }

    sectionalSubjects.push({ name, time });
    document.getElementById('new-sec-name').value = '';
    document.getElementById('new-sec-time').value = '';
    renderSectionalSubjectsList();
}

function removeSectionalSubject(index) {
    sectionalSubjects.splice(index, 1);
    renderSectionalSubjectsList();}

function renderSectionalSubjectsList() {
    const list = document.getElementById('sectional-subjects-list');
    if (sectionalSubjects.length === 0) {
        list.innerHTML = '<p class="text-xs text-gray-500 text-center py-2">No sections added yet.</p>';
        return;
    }

    let totalSecTime = sectionalSubjects.reduce((sum, sub) => sum + sub.time, 0);
    
    list.innerHTML = sectionalSubjects.map((sub, idx) => `
        <div class="section-item">
            <div class="section-info">
                <span class="section-name">${sub.name}</span>
                <span class="section-time">⏱️ ${sub.time} mins</span>
            </div>
            <button onclick="removeSectionalSubject(${idx})" class="remove-section-btn">✕</button>
        </div>
    `).join('');

    // Validation check
    const totalDuration = parseInt(document.getElementById('sec-duration').value) || 0;
    const errorMsg = document.getElementById('sec-time-error');
    if (totalDuration > 0 && totalSecTime !== totalDuration) {
        errorMsg.innerText = `Time mismatch! Sections: ${totalSecTime} mins, Total: ${totalDuration} mins.`;
        errorMsg.classList.remove('hidden');
    } else {
        errorMsg.classList.add('hidden');
    }
}

// Screen 1 Handler
function handleSectionalScreen1Submit() {
    const title = document.getElementById('sec-title').value.trim();
    const questions = parseInt(document.getElementById('sec-questions').value);
    const duration = parseInt(document.getElementById('sec-duration').value);
    const maxMarks = parseFloat(document.getElementById('sec-max-marks').value);
    const rightMarks = parseFloat(document.getElementById('sec-right-marks').value);
    const negativeMarks = parseFloat(document.getElementById('sec-negative-marks').value);

    if (!title || !questions || !duration || !maxMarks) { alert('Please fill all required fields.'); return; }
    if (sectionalSubjects.length === 0) { alert('Please add at least one subject with a sectional timer.'); return; }

    // Validate time match
    const totalSecTime = sectionalSubjects.reduce((sum, sub) => sum + sub.time, 0);
    if (totalSecTime !== duration) {
        alert(`Time mismatch!\nSum of section timers: ${totalSecTime} mins\nTotal Duration: ${duration} mins\n\nPlease adjust them to match.`);
        return;
    }
    // Save state
    currentSectionalTest = { title, totalQuestions: questions, duration, maxMarks, rightMarks, negativeMarks, subjects: sectionalSubjects };
    sectionalQuestions = {};
    sectionalSubjects.forEach(sub => { sectionalQuestions[sub.name] = []; });
    secCurrentQNum = 1;
    currentSecSubject = sectionalSubjects[0].name;

    // Clear inputs
    document.getElementById('sec-title').value = '';
    document.getElementById('sec-questions').value = '';
    document.getElementById('sec-duration').value = '';
    document.getElementById('sec-max-marks').value = '';
    document.getElementById('sec-right-marks').value = '';
    document.getElementById('sec-negative-marks').value = '';

    // Go to Screen 2
    document.getElementById('admin-sectional-screen1').classList.add('hidden');
    document.getElementById('admin-sectional-screen2').classList.remove('hidden');
    
    document.getElementById('sec-q-total').innerText = questions;
    renderSectionalSubjectTabs();
    updateSectionalProgress();
    clearSectionalForm();
}

// Screen 2 Tabs
function renderSectionalSubjectTabs() {
    const container = document.getElementById('sectional-subject-tabs');
    container.innerHTML = sectionalSubjects.map(sub => `
        <button onclick="switchSectionalSubject('${sub.name}', this)" class="subject-tab-test ${sub.name === currentSecSubject ? 'active' : ''}">
            ${sub.name} (${sectionalQuestions[sub.name].length})
        </button>
    `).join('');
}

function switchSectionalSubject(subject, btn) {
    currentSecSubject = subject;
    document.querySelectorAll('#sectional-subject-tabs .subject-tab-test').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    secCurrentQNum = sectionalQuestions[subject].length + 1;
    document.getElementById('sec-current-q-num').innerText = '#' + secCurrentQNum;
    clearSectionalForm();
}

// Image Upload (Reusing logic adapted)
function handleSecImageUpload(event, targetId) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 1048576) { alert('Image too large! Max 1MB.'); event.target.value = ''; return; }    const reader = new FileReader();
    reader.onload = function(e) {
        const preview = document.getElementById(targetId + '-preview');
        preview.innerHTML = `<div class="relative inline-block"><img src="${e.target.result}" class="max-h-20 rounded border"><button onclick="removeSecImage('${targetId}')" class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">✕</button></div>`;
        preview.setAttribute('data-image', e.target.result);
    };
    reader.readAsDataURL(file);
}

function removeSecImage(targetId) {
    const preview = document.getElementById(targetId + '-preview');
    preview.innerHTML = '';
    preview.removeAttribute('data-image');
}

// Save Question
function saveSectionalQuestion() {
    const qText = document.getElementById('sec-question-text').value.trim();
    const qImg = document.getElementById('sec-q-img-preview').getAttribute('data-image') || null;
    
    if (!qText && !qImg) { alert('Please enter question text or upload image.'); return; }

    const options = [];
    for (let i = 0; i < 4; i++) {
        const optText = document.getElementById('sec-opt-' + i).value.trim();
        const optImg = document.getElementById('sec-opt-' + i + '-img-preview').getAttribute('data-image') || null;
        if (!optText && !optImg) { alert(`Option ${String.fromCharCode(65+i)} is empty.`); return; }
        options.push({ text: optText, image: optImg });
    }

    const correctOpt = parseInt(document.querySelector('input[name="sec-correct-opt"]:checked').value);

    sectionalQuestions[currentSecSubject].push({
        id: secCurrentQNum, text: qText, image: qImg, options, correct: correctOpt
    });

    updateSectionalProgress();
    renderSectionalSubjectTabs(); // Update counts in tabs
    clearSectionalForm();
    secCurrentQNum++;
    document.getElementById('sec-current-q-num').innerText = '#' + secCurrentQNum;

    const totalAdded = Object.values(sectionalQuestions).flat().length;
    if (totalAdded >= currentSectionalTest.totalQuestions) {
        document.getElementById('sec-publish-btn').classList.remove('hidden');
        alert('All questions added! You can now publish.');
    } else {
        alert(`Question saved! (${totalAdded}/${currentSectionalTest.totalQuestions})`);
    }
}
function clearSectionalForm() {
    document.getElementById('sec-question-text').value = '';
    removeSecImage('sec-q-img');
    for (let i = 0; i < 4; i++) {
        document.getElementById('sec-opt-' + i).value = '';
        removeSecImage('sec-opt-' + i + '-img');
    }
    document.querySelector('input[name="sec-correct-opt"][value="0"]').checked = true;
}

function updateSectionalProgress() {
    const total = Object.values(sectionalQuestions).flat().length;
    document.getElementById('sec-q-count').innerText = total;
}

// Preview Toggle
function toggleSectionalPreview() {
    const modal = document.getElementById('sectional-preview-modal');
    modal.classList.toggle('hidden');
    if (!modal.classList.contains('hidden')) {
        renderSectionalPreview();
    }
}

function renderSectionalPreview() {
    const content = document.getElementById('sectional-preview-content');
    let html = '';
    
    sectionalSubjects.forEach(sub => {
        const qs = sectionalQuestions[sub.name];
        if (qs.length === 0) return;
        html += `<h4 class="font-bold text-blue-600 mt-4 mb-2">${sub.name} (${qs.length} Qs)</h4>`;
        qs.forEach((q, idx) => {
            html += `
                <div class="preview-q-item">
                    <div class="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Q${idx + 1}</span>
                        <button onclick="editSectionalQuestion('${sub.name}', ${idx})" class="text-blue-600 font-bold">Edit</button>
                    </div>
                    <p class="text-sm text-gray-800">${q.text || '[Image Question]'}</p>
                </div>
            `;
        });
    });
    
    content.innerHTML = html || '<p class="text-center text-gray-500">No questions added yet.</p>';
}

function editSectionalQuestion(subject, index) {    toggleSectionalPreview(); // Close modal
    switchSectionalSubject(subject, document.querySelector(`button[onclick="switchSectionalSubject('${subject}', this)"]`));
    
    const q = sectionalQuestions[subject][index];
    document.getElementById('sec-question-text').value = q.text || '';
    if (q.image) {
        const preview = document.getElementById('sec-q-img-preview');
        preview.innerHTML = `<div class="relative inline-block"><img src="${q.image}" class="max-h-20 rounded border"><button onclick="removeSecImage('sec-q-img')" class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">✕</button></div>`;
        preview.setAttribute('data-image', q.image);
    }
    for (let i = 0; i < 4; i++) {
        document.getElementById('sec-opt-' + i).value = q.options[i].text || '';
        if (q.options[i].image) {
            const preview = document.getElementById('sec-opt-' + i + '-img-preview');
            preview.innerHTML = `<div class="relative inline-block"><img src="${q.options[i].image}" class="max-h-20 rounded border"><button onclick="removeSecImage('sec-opt-${i}-img')" class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">✕</button></div>`;
            preview.setAttribute('data-image', q.options[i].image);
        }
    }
    document.querySelector(`input[name="sec-correct-opt"][value="${q.correct}"]`).checked = true;
    document.getElementById('sec-current-q-num').innerText = `#${index + 1} (Editing)`;
    
    // Remove the old one so saving adds the updated version
    sectionalQuestions[subject].splice(index, 1);
    secCurrentQNum = index + 1;
}

// Publish to Database
async function publishSectionalTest() {
    const totalAdded = Object.values(sectionalQuestions).flat().length;
    if (totalAdded !== currentSectionalTest.totalQuestions) {
        alert('Please add all questions before publishing.');
        return;
    }

    const btn = document.getElementById('sec-publish-btn');
    btn.innerText = 'Publishing...';
    btn.disabled = true;

    try {
        const { data: { user } } = await db.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        // 1. Insert Test
        const { data: test, error: testError } = await db
            .from('tests')
            .insert({
                title: currentSectionalTest.title,
                test_type: 'sectional_timer', // CRITICAL TAG
                total_questions: currentSectionalTest.totalQuestions,
                max_marks: currentSectionalTest.maxMarks,                duration: currentSectionalTest.duration,
                right_marks: currentSectionalTest.rightMarks,
                negative_marks: currentSectionalTest.negativeMarks,
                subjects: sectionalSubjects.map(s => s.name),
                sectional_timers: sectionalSubjects, // Store as JSONB
                optional_subjects: null,
                created_by: user.id,
                is_published: true
            })
            .select().single();

        if (testError) throw testError;

        // 2. Insert Questions
        let questionsToInsert = [];
        let globalQNum = 1;
        sectionalSubjects.forEach(sub => {
            sectionalQuestions[sub.name].forEach(q => {
                questionsToInsert.push({
                    test_id: test.id,
                    subject: sub.name,
                    question_number: globalQNum,
                    question_text: q.text,
                    question_image: q.image,
                    options: q.options,
                    correct_option: q.correct
                });
                globalQNum++;
            });
        });

        const { error: qError } = await db.from('questions').insert(questionsToInsert);
        if (qError) throw qError;

        alert(' Sectional Timer Test Published Successfully!');
        
        currentSectionalTest = null;
        sectionalSubjects = [];
        sectionalQuestions = {};
        btn.innerText = ' Publish Sectional Test';
        btn.disabled = false;
        document.getElementById('sec-publish-btn').classList.add('hidden');
        goBackToAdminHome();

    } catch (error) {
        console.error('Publish Error:', error);
        alert('Error: ' + error.message);
        btn.innerText = ' Publish Sectional Test';
        btn.disabled = false;
    }}

// =============================================
// CANDIDATE: SECTIONAL TIMER TESTS LIST
// =============================================
async function showCandidateSectionalTests() {
    document.getElementById('candidate-dashboard').classList.add('hidden');
    document.getElementById('candidate-bottom-nav').classList.add('hidden');
    document.getElementById('candidate-sectional-list').classList.remove('hidden');
    
    const container = document.getElementById('candidate-sectional-container');
    container.innerHTML = '<p class="text-white/60 text-sm text-center py-8">Loading tests...</p>';
    
    try {
        const { data: tests, error } = await db
            .from('tests')
            .select('*')
            .eq('test_type', 'sectional_timer')
            .eq('is_published', true)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        if (!tests || tests.length === 0) {
            container.innerHTML = `
                <div class="glass-card p-8 text-center">
                    <p class="text-5xl mb-3">⏳</p>
                    <p class="text-white font-semibold">No Sectional Tests Available</p>
                    <p class="text-white/70 text-sm mt-2">Check back later!</p>
                </div>
            `;
            return;
        }
        
        const attemptsMap = {};
        await Promise.all(tests.map(async (test) => {
            attemptsMap[test.id] = await getUserAttemptsForTest(test.id);
        }));
        
        container.innerHTML = tests.map(test => {
            const attempts = attemptsMap[test.id];
            const attemptCount = attempts.length;
            const attemptBadge = attemptCount > 0 
                ? `<span class="px-2 py-0.5 bg-yellow-500/20 border border-yellow-400/30 text-yellow-200 text-[10px] rounded">Attempted ${attemptCount}/${MAX_ATTEMPTS}</span>`
                : '';
            
            // Format sections for display
            const sectionsDisplay = test.sectional_timers.map(s => `${s.name} (${s.time}m)`).join(' • ');
            
            return `
                <div class="glass-card p-4 space-y-3">
                    <div class="flex justify-between items-start">
                        <div class="flex-1">
                            <h3 class="text-white font-bold text-lg">${test.title}</h3>
                            <p class="text-pink-200/80 text-xs mt-1">
                                ${new Date(test.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                        </div>
                        <div class="flex flex-col gap-1 items-end">
                            <span class="px-2 py-1 bg-purple-500/20 border border-purple-400/30 text-purple-200 text-xs rounded-lg">SECTIONAL</span>
                            ${attemptBadge}
                        </div>
                    </div>
                    
                    <div class="p-2 bg-white/5 rounded-lg border border-white/10">
                        <p class="text-white/60 text-[10px] mb-1">Sections & Timers:</p>
                        <p class="text-white text-xs font-medium">${sectionsDisplay}</p>
                    </div>
                    
                    <div class="grid grid-cols-3 gap-2 text-center">
                        <div class="p-2 bg-white/5 rounded-lg">
                            <p class="text-white/60 text-[10px]">Questions</p>
                            <p class="text-white font-bold text-sm">${test.total_questions}</p>
                        </div>
                        <div class="p-2 bg-white/5 rounded-lg">
                            <p class="text-white/60 text-[10px]">Total Time</p>
                            <p class="text-white font-bold text-sm">${test.duration} min</p>
                        </div>
                        <div class="p-2 bg-white/5 rounded-lg">
                            <p class="text-white/60 text-[10px]">Max Marks</p>
                            <p class="text-white font-bold text-sm">${test.max_marks}</p>
                        </div>
                    </div>
                    
                    ${renderTestButtons(test.id, attempts)}
                </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Load Sectional Tests Error:', error);
        container.innerHTML = `<p class="text-red-300 text-sm text-center py-8">Error: ${error.message}</p>`;
    }
}

// =============================================
// SECTIONAL TEST LOGIC (REGENERATED & CLEAN)
// =============================================

// 1. REPLACED: startActualTest
function startActualTest() {
    closeTestInfoPopup();
    
    // Filter questions if optional subject selected (for Free Mocks)
    if (selectedOptionalSubject) {
        activeQuestions = activeQuestions.filter(q => q.subject === selectedOptionalSubject);
    }
    
    if (activeQuestions.length === 0) {
        alert('No questions available for this selection');
        return;
    }
    
    // Hide candidate dashboards
    document.getElementById('candidate-dashboard').classList.add('hidden');
    document.getElementById('candidate-bottom-nav').classList.add('hidden');
    document.getElementById('candidate-free-mock-list').classList.add('hidden');
    document.getElementById('candidate-mini-mock-list').classList.add('hidden');
    document.getElementById('candidate-sectional-list').classList.add('hidden');
    
    // Show test interface
    document.getElementById('test-interface').classList.remove('hidden');
    document.getElementById('test-candidate-name').innerText = document.getElementById('candidate-name').innerText;
    
    // CHECK IF SECTIONAL TEST
    if (activeTest.test_type === 'sectional_timer' && activeTest.sectional_timers) {
        isSectionalTest = true;
        sectionalTimers = activeTest.sectional_timers;
        currentSectionIndex = 0;
        
        renderTestSubjectTabs(); 
        loadSection(0); 
    } else {
        isSectionalTest = false;
        timeRemaining = activeTest.duration * 60;
        renderTestSubjectTabs();
        loadQuestion(0);
        startTimer();
    }
}

// 2. REPLACED: renderTestSubjectTabs (Handles locking tabs)
function renderTestSubjectTabs() {
    const container = document.getElementById('test-subject-tabs');
    const subjects = [...new Set(activeQuestions.map(q => q.subject))];    
    container.innerHTML = subjects.map((sub) => {
        let isActive = false;
        let isDisabled = false;
        
        if (isSectionalTest) {
            const currentSectionName = sectionalTimers[currentSectionIndex] ? sectionalTimers[currentSectionIndex].name : '';
            isActive = (sub === currentSectionName);
            isDisabled = (sub !== currentSectionName); // Lock other tabs
        } else {
            isActive = (sub === currentSubjectInTest);
        }
        
        const activeClass = isActive ? 'active' : '';
        const disabledClass = isDisabled ? 'opacity-50 cursor-not-allowed' : '';
        const clickHandler = isDisabled ? '' : `onclick="jumpToSubject('${sub}', this)"`;
        
        return `<button class="subject-tab-test ${activeClass} ${disabledClass}" ${clickHandler}>${sub}</button>`;
    }).join('');
    
    if (!isSectionalTest && subjects.length > 0 && !currentSubjectInTest) {
        currentSubjectInTest = subjects[0];
    }
}

// 3. REPLACED: jumpToSubject (Prevents switching in sectional mode)
function jumpToSubject(subject, btnElement) {
    if (isSectionalTest) {
        const currentSectionName = sectionalTimers[currentSectionIndex] ? sectionalTimers[currentSectionIndex].name : '';
        if (subject !== currentSectionName) {
            alert(`🔒 You cannot switch to ${subject} yet!\n\nPlease wait for the ${currentSectionName} timer to finish.`);
            return;
        }
    }
    
    currentSubjectInTest = subject;
    
    const firstQuestionIndex = activeQuestions.findIndex(q => q.subject === subject);
    if (firstQuestionIndex !== -1) {
        loadQuestion(firstQuestionIndex);
    }
    
    // Re-render to update active tab styling
    renderTestSubjectTabs();
}

// 4. REPLACED: updateTimerDisplay (Shows section name)
function updateTimerDisplay() {
    let timeToShow = isSectionalTest ? sectionTimeRemaining : timeRemaining;
        const hours = Math.floor(timeToShow / 3600);
    const minutes = Math.floor((timeToShow % 3600) / 60);
    const seconds = timeToShow % 60;
    
    const display = document.getElementById('timer-display');
    let timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    if (isSectionalTest) {
        const sectionName = sectionalTimers[currentSectionIndex] ? sectionalTimers[currentSectionIndex].name : '';
        display.innerText = `${sectionName}: ${timeString}`;
    } else {
        display.innerText = timeString;
    }
    
    let totalTime = isSectionalTest ? (sectionalTimers[currentSectionIndex] ? sectionalTimers[currentSectionIndex].time * 60 : 0) : (activeTest.duration * 60);
    const threshold = totalTime * 0.3;
    
    if (timeToShow <= threshold && timeToShow > 0) {
        display.classList.add('danger');
    } else {
        display.classList.remove('danger');
    }
}

// 5. NEW: startSectionalTimer
function startSectionalTimer() {
    clearInterval(testTimer); // Clear any existing timer first
    
    if (currentSectionIndex >= sectionalTimers.length) {
        submitTest(true);
        return;
    }
    
    sectionTimeRemaining = sectionalTimers[currentSectionIndex].time * 60;
    updateTimerDisplay();
    
    testTimer = setInterval(() => {
        sectionTimeRemaining--;
        updateTimerDisplay();
        
        if (sectionTimeRemaining <= 0) {
            clearInterval(testTimer);
            
            currentSectionIndex++;
            if (currentSectionIndex < sectionalTimers.length) {
                const nextSection = sectionalTimers[currentSectionIndex].name;
                const prevSection = sectionalTimers[currentSectionIndex - 1].name;
                alert(`⏰ Time up for ${prevSection}!\n\nAutomatically moving to ${nextSection}.`);
                loadSection(currentSectionIndex);
            } else {                alert("✅ All sections completed! Submitting your test.");
                submitTest(true);
            }
        }
    }, 1000);
}

// 6. NEW: loadSection
function loadSection(sectionIndex) {
    currentSectionIndex = sectionIndex;
    const sectionName = sectionalTimers[sectionIndex].name;
    
    const firstQIndex = activeQuestions.findIndex(q => q.subject === sectionName);
    if (firstQIndex !== -1) {
        loadQuestion(firstQIndex);
    }
    
    renderTestSubjectTabs();
    startSectionalTimer();
}

// =============================================
// ADMIN: NOTIFICATION LOGIC
// =============================================
let notifPdfBase64 = null;

function showAdminNotificationScreen() {
    document.getElementById('admin-dashboard').classList.add('hidden');
    document.getElementById('admin-bottom-nav').classList.add('hidden');
    document.getElementById('admin-notification-screen').classList.remove('hidden');
    
    // Reset form
    document.getElementById('notif-title').value = '';
    document.getElementById('notif-body').value = '';
    document.getElementById('notif-pdf-preview').innerHTML = '';
    notifPdfBase64 = null;
}

function handleNotifPdfUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Check size (8MB limit to prevent DB errors)
    if (file.size > 8388608) {
        alert('❌ PDF too large! Maximum size is 8MB.');
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        notifPdfBase64 = e.target.result;
        document.getElementById('notif-pdf-preview').innerHTML = `
            <div class="flex items-center gap-2 text-green-600 font-semibold">
                <span>✅ ${file.name}</span>
                <button onclick="removeNotifPdf()" class="text-red-500 text-xs ml-2">Remove</button>
            </div>
        `;
    };
    reader.readAsDataURL(file);
}

function removeNotifPdf() {
    notifPdfBase64 = null;
    document.getElementById('notif-pdf-preview').innerHTML = '';
    // Reset file input
    const fileInput = document.querySelector('input[type="file"][accept="application/pdf"]');
    if (fileInput) fileInput.value = '';
}

async function sendNotification() {
    const title = document.getElementById('notif-title').value.trim();
    const body = document.getElementById('notif-body').value.trim();

    if (!title || !body) {
        alert('Please enter both Title and Body.');
        return;
    }

    const btn = document.getElementById('send-notif-btn');
    btn.innerText = 'Sending...';
    btn.disabled = true;

    try {
        const { data: { user } } = await db.auth.getUser();
        if (!user) throw new Error('Not authenticated');

        const { error } = await db.from('notifications').insert({
            title: title,
            body: body,
            pdf_base64: notifPdfBase64,
            created_by: user.id
        });

        if (error) throw error;

        alert('✅ Notification Sent Successfully!');
        goBackToAdminHome();

    } catch (error) {
        console.error('Send Notification Error:', error);
        alert('❌ Error: ' + error.message);
    } finally {
        btn.innerText = ' Send Notification';
        btn.disabled = false;
    }
}

// =============================================
// CANDIDATE: NOTIFICATIONS & DOWNLOADS
// =============================================
let realtimeNotifChannel = null;

// 1. Navigation
function showCandidateNotifications() {
    document.getElementById('candidate-dashboard').classList.add('hidden');
    document.getElementById('candidate-bottom-nav').classList.add('hidden');
    document.getElementById('candidate-notif-list').classList.remove('hidden');
    
    loadNotifications();
    setupRealtimeNotifications();
}

function closeDownloadsScreen() {
    document.getElementById('candidate-downloads-screen').classList.add('hidden');
    document.getElementById('candidate-dashboard').classList.remove('hidden');
    document.getElementById('candidate-bottom-nav').classList.remove('hidden');
}

// 2. Load Initial Notifications
async function loadNotifications() {
    const container = document.getElementById('candidate-notif-container');
    container.innerHTML = '<p class="text-white/60 text-sm text-center py-8">Loading...</p>';
    
    try {
        const { data, error } = await db
            .from('notifications')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        renderNotifications(data || []);
    } catch (error) {
        container.innerHTML = `<p class="text-red-300 text-sm text-center py-8">Error: ${error.message}</p>`;
    }
}

function renderNotifications(notifs) {
    const container = document.getElementById('candidate-notif-container');
    if (notifs.length === 0) {
        container.innerHTML = '<p class="text-white/60 text-sm text-center py-8">No notifications yet.</p>';
        return;
    }
    
    container.innerHTML = notifs.map(n => {
        const date = new Date(n.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        const pdfBtn = n.pdf_base64 
            ? `<button onclick="downloadNotifPdf('${n.id}', '${n.title.replace(/'/g, "\\'")}', '${n.pdf_base64}')" class="notif-pdf-btn">📄 Download PDF</button>`             : '';
            
        return `
            <div class="notif-card">
                <div class="notif-title">${n.title}</div>
                <div class="notif-date">${date}</div>
                <div class="notif-body">${n.body.replace(/\n/g, '<br>')}</div>
                ${pdfBtn}
            </div>
        `;
    }).join('');
}

// 3. Real-time Listener
function setupRealtimeNotifications() {
    if (realtimeNotifChannel) return; // Prevent duplicate listeners
    
    realtimeNotifChannel = db.channel('public:notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, payload => {
            // Prepend new notification to the list
            const container = document.getElementById('candidate-notif-container');
            const n = payload.new;
            const date = new Date(n.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            
            const newNotifHtml = `
                <div class="notif-card" style="animation: fadeIn 0.5s;">
                    <div class="notif-title">${n.title}</div>
                    <div class="notif-date">${date} • NEW</div>
                    <div class="notif-body">${n.body.replace(/\n/g, '<br>')}</div>
                    ${n.pdf_base64 ? `<button onclick="downloadNotifPdf('${n.id}', '${n.title.replace(/'/g, "\\'")}', '${n.pdf_base64}')" class="notif-pdf-btn">📄 Download PDF</button>` : ''}
                </div>
            `;
            
            // Remove "No notifications" text if it exists
            if (container.innerHTML.includes('No notifications yet')) {
                container.innerHTML = newNotifHtml;
            } else {
                container.innerHTML = newNotifHtml + container.innerHTML;
            }
            
            // Optional: Vibrate phone for new notification
            if (navigator.vibrate) navigator.vibrate(200);
        })
        .subscribe();
}

// 4. PDF Download Logic
function downloadNotifPdf(id, title, base64String) {
    try {
        // Ensure the string has the correct data URI prefix
        let dataUri = base64String;
        if (!base64String.startsWith('data:')) {
            dataUri = 'data:application/pdf;base64,' + base64String;
        }
        
        // Create a temporary link element to trigger the download
        const link = document.createElement('a');
        link.href = dataUri;
        link.download = `${title}.pdf`;
        link.target = '_blank'; // Helps mobile browsers handle the file better
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Save to LocalStorage for the Downloads Tab
        saveToDownloads({ id, title, date: new Date().toISOString() });
        
        alert('✅ PDF Downloaded Successfully!\n\nYou can find it in the "Downloads" tab.');
    } catch (error) {
        console.error('Download error:', error);
        alert('❌ Error downloading PDF: ' + error.message);
    }
}

// 5. LocalStorage Management for Downloads
function saveToDownloads(item) {
    let downloads = JSON.parse(localStorage.getItem('mockprep_downloads') || '[]');
    // Prevent duplicates
    if (!downloads.find(d => d.id === item.id)) {
        downloads.unshift(item);
        localStorage.setItem('mockprep_downloads', JSON.stringify(downloads));
    }
}

function loadDownloadsTab() {
    const container = document.getElementById('downloads-container');
    const downloads = JSON.parse(localStorage.getItem('mockprep_downloads') || '[]');
    
    if (downloads.length === 0) {
        container.innerHTML = '<p class="text-white/60 text-sm text-center py-8">No downloads yet.</p>';
        return;
    }
    
    container.innerHTML = downloads.map(d => {
        const date = new Date(d.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
        return `            <div class="download-item">
                <div class="flex-1">
                    <p class="text-white font-semibold text-sm">${d.title}.pdf</p>
                    <p class="text-pink-200/80 text-xs">Downloaded: ${date}</p>
                </div>
                <button onclick="alert('File already downloaded to your device!')" class="px-3 py-1 bg-white/20 border border-white/30 text-white text-xs rounded-lg">Open</button>
            </div>
        `;
    }).join('');
}

// =============================================
// ADMIN: PROFILE & CONTROL PANEL LOGIC
// =============================================

function showAdminProfile() {
    document.getElementById('admin-dashboard').classList.add('hidden');
    document.getElementById('admin-bottom-nav').classList.add('hidden');
    document.getElementById('admin-profile-screen').classList.remove('hidden');
    
    loadAdminProfileData();
}

async function loadAdminProfileData() {
    try {
        // 1. Get Admin Details
        const { data: { user } } = await db.auth.getUser();
        if (user) {
            document.getElementById('prof-admin-email').innerText = user.email;
            document.getElementById('prof-admin-date').innerText = new Date(user.created_at).toLocaleDateString();
            
            // Fetch full name from profiles
            const { data: profile } = await db.from('profiles').select('full_name').eq('id', user.id).single();
            document.getElementById('prof-admin-name').innerText = profile?.full_name || 'Admin';
        }

        // 2. Fetch Stats (Users & Tests)
        const { count: userCount } = await db.from('profiles').select('*', { count: 'exact', head: true });
        const { count: testCount } = await db.from('tests').select('*', { count: 'exact', head: true }).eq('is_published', true);
        
        document.getElementById('stat-total-users').innerText = userCount || 0;
        document.getElementById('stat-active-tests').innerText = testCount || 0;

        // Also update the Home Dashboard stats if they exist
        const homeUsersEl = document.querySelector('#admin-dashboard .text-white.font-bold'); // Simple selector for the stats card
        // (We will update the home dashboard HTML in the next step to have IDs)

        // 3. Fetch Today's Attempts
        const today = new Date().toISOString().split('T')[0];
        const { count: todayAttempts } = await db
            .from('test_attempts')
            .select('*', { count: 'exact', head: true })
            .gte('completed_at', `${today}T00:00:00`);
        document.getElementById('stat-today-attempts').innerText = todayAttempts || 0;

        // 4. Load Lists
        loadAdminActiveTests();
        loadAdminNotifications();
        loadAdminUsers();

// Update Home Dashboard Stats
        document.getElementById('home-stat-users').innerText = userCount || 0;
        document.getElementById('home-stat-tests').innerText = testCount || 0;

    } catch (error) {        console.error('Profile Load Error:', error);
    }
}

async function loadAdminActiveTests() {
    const container = document.getElementById('admin-active-tests-list');
    const { data: tests, error } = await db.from('tests').select('*').eq('is_published', true).order('created_at', { ascending: false });
    
    if (error || !tests || tests.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 text-center py-2">No active tests.</p>';
        return;
    }

    container.innerHTML = tests.map(t => `
        <div class="list-item">
            <div class="list-item-info">
                <div class="list-item-title">${t.title}</div>
                <div class="list-item-sub">${t.total_questions} Qs • ${t.test_type.replace('_', ' ')}</div>
            </div>
            <button onclick="deleteTest('${t.id}')" class="delete-btn">Delete</button>
        </div>
    `).join('');
}

async function deleteTest(testId) {
    if (!confirm('Are you sure you want to delete this test? This cannot be undone.')) return;
    
    // Delete questions first (cascade should handle it, but good practice)
    await db.from('questions').delete().eq('test_id', testId);
    const { error } = await db.from('tests').delete().eq('id', testId);
    
    if (error) alert('Error deleting test');
    else {
        alert('Test deleted successfully');
        loadAdminActiveTests(); // Refresh list
        loadAdminProfileData(); // Update stats
    }
}

async function loadAdminNotifications() {
    const container = document.getElementById('admin-notifications-list');
    const { data: notifs, error } = await db.from('notifications').select('*').order('created_at', { ascending: false });
    
    if (error || !notifs || notifs.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 text-center py-2">No notifications sent.</p>';
        return;
    }

    container.innerHTML = notifs.map(n => `
        <div class="list-item">            <div class="list-item-info">
                <div class="list-item-title">${n.title}</div>
                <div class="list-item-sub">${new Date(n.created_at).toLocaleDateString()} ${n.pdf_base64 ? '• 📎 PDF' : ''}</div>
            </div>
            <button onclick="deleteNotification('${n.id}')" class="delete-btn">Delete</button>
        </div>
    `).join('');
}

async function deleteNotification(notifId) {
    if (!confirm('Delete this notification?')) return;
    const { error } = await db.from('notifications').delete().eq('id', notifId);
    if (error) alert('Error deleting notification');
    else {
        alert('Notification deleted');
        loadAdminNotifications();
    }
}

async function loadAdminUsers() {
    const container = document.getElementById('admin-users-list');
    // Fetch profiles (excluding the current admin)
    const { data: { user } } = await db.auth.getUser();
    const { data: users, error } = await db.from('profiles').select('*').neq('id', user.id).order('created_at', { ascending: false });
    
    if (error || !users || users.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 text-center py-2">No registered candidates.</p>';
        return;
    }

    container.innerHTML = users.map(u => `
        <div class="list-item">
            <div class="list-item-info">
                <div class="list-item-title">${u.full_name || 'Unknown User'}</div>
                <div class="list-item-sub">${u.role} • Joined ${new Date(u.created_at).toLocaleDateString()}</div>
            </div>
            <button onclick="deleteUser('${u.id}')" class="delete-btn">Remove</button>
        </div>
    `).join('');
}

async function deleteUser(userId) {
    if (!confirm('Are you sure you want to remove this user?')) return;
    
    // Note: Client-side cannot fully delete auth users without Service Role key.
    // We will delete their profile and attempts.
    await db.from('test_attempts').delete().eq('user_id', userId);
    const { error } = await db.from('profiles').delete().eq('id', userId);
    
    if (error) alert('Error removing user profile');    else {
        alert('User removed from platform');
        loadAdminUsers();
        loadAdminProfileData();
    }
}

// =============================================
// CANDIDATE: PROFILE & SETTINGS LOGIC
// =============================================

function showCandidateProfile() {
    document.getElementById('candidate-dashboard').classList.add('hidden');
    document.getElementById('candidate-bottom-nav').classList.add('hidden');
    document.getElementById('candidate-profile-screen').classList.remove('hidden');
    
    loadCandidateProfileData();
}

async function loadCandidateProfileData() {
    try {
        const { data: { user } } = await db.auth.getUser();
        if (!user) return;

        // 1. Basic Info
        document.getElementById('cand-profile-email').innerText = user.email;
        document.getElementById('cand-email-display').innerText = user.email;
        document.getElementById('cand-profile-date').innerText = new Date(user.created_at).toLocaleDateString();

        // 2. Fetch Profile Details
        const { data: profile } = await db.from('profiles').select('*').eq('id', user.id).single();
        if (profile) {
            document.getElementById('cand-profile-name').innerText = profile.full_name || 'Candidate';
            document.getElementById('cand-name-display').innerText = profile.full_name || 'Not Set';
            document.getElementById('cand-mobile-display').innerText = profile.mobile_number || 'Not Added';
            
            // Load profile image if exists
            if (profile.profile_image) {
                document.getElementById('profile-image-preview').src = profile.profile_image;
                document.getElementById('profile-image-preview').style.display = 'block';
                document.getElementById('profile-image-placeholder').style.display = 'none';
            }
        }

        // 3. Load Test Attempts
        loadCandidateAttempts();

    } catch (error) {
        console.error('Profile Load Error:', error);
    }
}

async function loadCandidateAttempts() {
    const { data: { user } } = await db.auth.getUser();
    if (!user) return;

    // Fetch all attempts for this user
    const { data: attempts, error } = await db
        .from('test_attempts')
        .select('*, tests(title, created_at)')
        .eq('user_id', user.id)
        .order('completed_at', { ascending: false });

    if (error || !attempts) {
        document.getElementById('cand-total-attempts').innerText = '0';
        return;
    }

    // Update total count
    document.getElementById('cand-total-attempts').innerText = attempts.length;

    // Render attempts list (Test Name + Date)
    const attemptsList = document.getElementById('cand-attempts-list');
    if (attempts.length === 0) {
        attemptsList.innerHTML = '<p class="text-sm text-gray-500 text-center py-2">No attempts yet.</p>';
    } else {
        attemptsList.innerHTML = attempts.map(a => `
            <div class="attempt-card">
                <div class="attempt-header">
                    <div class="attempt-title">${a.tests?.title || 'Unknown Test'}</div>
                    <div class="attempt-date">${new Date(a.completed_at).toLocaleDateString()}</div>
                </div>
            </div>
        `).join('');
    }

    // Render previous attempts with detailed stats
    const prevAttemptsList = document.getElementById('cand-previous-attempts-list');
    if (attempts.length === 0) {
        prevAttemptsList.innerHTML = '<p class="text-sm text-gray-500 text-center py-2">No previous attempts.</p>';
    } else {
        prevAttemptsList.innerHTML = attempts.map(a => {
            const minutes = Math.floor(a.time_taken / 60);
            const seconds = a.time_taken % 60;
            return `
                <div class="attempt-card">
                    <div class="attempt-header">
                        <div class="attempt-title">${a.tests?.title || 'Unknown Test'}</div>
                        <div class="attempt-date">Attempt #${a.attempt_number}</div>
                    </div>
                    <div class="attempt-stats">
                        <div class="attempt-stat">
                            <div class="attempt-stat-value">${a.score}</div>
                            <div class="attempt-stat-label">Marks</div>
                        </div>
                        <div class="attempt-stat">
                            <div class="attempt-stat-value">#${a.attempt_number}</div>                            <div class="attempt-stat-label">Rank</div>
                        </div>
                        <div class="attempt-stat">
                            <div class="attempt-stat-value">${minutes}m ${seconds}s</div>
                            <div class="attempt-stat-label">Time</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

// Edit Functions
async function editCandidateName() {
    const newName = prompt('Enter your new name:');
    if (!newName || newName.trim() === '') return;

    const { data: { user } } = await db.auth.getUser();
    const { error } = await db.from('profiles').update({ full_name: newName.trim() }).eq('id', user.id);

    if (error) alert('Error updating name');
    else {
        alert('✅ Name updated successfully!');
        loadCandidateProfileData();
    }
}

async function editCandidateMobile() {
    const newMobile = prompt('Enter your mobile number (optional):');
    if (newMobile === null) return;

    const { data: { user } } = await db.auth.getUser();
    const { error } = await db.from('profiles').update({ mobile_number: newMobile.trim() }).eq('id', user.id);

    if (error) {
        // Column might not exist, create it
        if (error.message.includes('mobile_number')) {
            alert('⚠️ Mobile number feature needs database setup. Please contact support.');
        } else {
            alert('Error updating mobile');
        }
    } else {
        alert('✅ Mobile number updated!');
        loadCandidateProfileData();
    }
}

async function handleProfileImageUpload(event) {
    const file = event.target.files[0];    if (!file) return;

    if (file.size > 1048576) {
        alert('❌ Image too large! Max 1MB.');
        return;
    }

    const reader = new FileReader();
    reader.onload = async function(e) {
        const base64 = e.target.result;
        
        // Show preview
        document.getElementById('profile-image-preview').src = base64;
        document.getElementById('profile-image-preview').style.display = 'block';
        document.getElementById('profile-image-placeholder').style.display = 'none';

        // Save to database
        const { data: { user } } = await db.auth.getUser();
        const { error } = await db.from('profiles').update({ profile_image: base64 }).eq('id', user.id);

        if (error) {
            alert('Error saving image');
        } else {
            alert('✅ Profile image updated!');
        }
    };
    reader.readAsDataURL(file);
}

function changeCandidatePassword() {
    const { data: { user } } = db.auth.getUser();
    if (user) {
        db.auth.resetPasswordForEmail(user.email);
        alert('📧 Password reset link sent to your email!');
    }
}

// Settings Functions
function toggleDarkMode() {
    const toggle = document.getElementById('dark-mode-toggle');
    toggle.classList.toggle('active');
    document.body.classList.toggle('dark-mode');
    
    // Save preference
    localStorage.setItem('mockprep_dark_mode', toggle.classList.contains('active'));
}

function changeFontSize() {
    const sizes = ['Small', 'Medium', 'Large'];
    const current = localStorage.getItem('mockprep_font_size') || 'Medium';    const currentIndex = sizes.indexOf(current);
    const nextSize = sizes[(currentIndex + 1) % sizes.length];
    
    localStorage.setItem('mockprep_font_size', nextSize);
    document.getElementById('current-font-size').innerText = nextSize;
    
    // Apply font size
    const sizeMap = { 'Small': '14px', 'Medium': '16px', 'Large': '18px' };
    document.body.style.fontSize = sizeMap[nextSize];
    
    alert(`✅ Font size changed to ${nextSize}`);
}

async function logoutFromAllDevices() {
    if (!confirm('Are you sure you want to logout from all devices?')) return;
    
    await db.auth.signOut({ scope: 'global' });
    alert('✅ Logged out from all devices');
    window.location.reload();
}

// Load saved preferences on app start
function loadUserPreferences() {
    // Dark mode
    const isDarkMode = localStorage.getItem('mockprep_dark_mode') === 'true';
    if (isDarkMode) {
        document.body.classList.add('dark-mode');
        const toggle = document.getElementById('dark-mode-toggle');
        if (toggle) toggle.classList.add('active');
    }

    // Font size
    const fontSize = localStorage.getItem('mockprep_font_size') || 'Medium';
    const sizeMap = { 'Small': '14px', 'Medium': '16px', 'Large': '18px' };
    document.body.style.fontSize = sizeMap[fontSize];
    const fontSizeDisplay = document.getElementById('current-font-size');
    if (fontSizeDisplay) fontSizeDisplay.innerText = fontSize;
}

// =============================================
// PERSISTENT LOGIN (AUTO-LOGIN)
// =============================================
async function autoLogin() {
    // 1. Check if a session already exists in the browser/app
    const { data: { session } } = await db.auth.getSession();
    
    // 2. If session exists, the user is already logged in!
    if (session) {
        // Fetch their profile to get their role and name
        const { data: profile } = await db
            .from('profiles')
            .select('role, full_name')
            .eq('id', session.user.id)
            .single();
        
        if (profile) {
            // Hide the login screen
            document.getElementById('auth-container').classList.add('hidden');
            
            // Automatically show the correct dashboard
            showDashboard(profile.role, profile.full_name);
        }
    } else {
        // No session found, show the login screen (default behavior)
        generateCaptcha();
    }
}

// Run this when the app loads
document.addEventListener('DOMContentLoaded', () => {
    autoLogin();
    loadUserPreferences(); // Loads dark mode/font size if you added it
});

// =============================================
// INIT
// =============================================
generateCaptcha();